// 增量推送：只更新 <subdir>/* 到 gh-pages（保留其他文件）。
// 用法: GH_TOKEN=xxx node scripts/push_ghpages_subdir_api.mjs <local-subdir> <remote-subdir> [branch]
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1); }
const LOCAL = process.argv[2];
const REMOTE = process.argv[3] || path.basename(LOCAL);
const BRANCH = process.argv[4] || 'gh-pages';
const OWNER = 'a9f7';
const REPO = 'ticketmonitor';
const API = 'https://api.github.com';
const auth = { Authorization: `Bearer ${TOKEN}` };

const log = (...a) => process.stderr.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function api(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json', 'User-Agent': 'workbuddy-push' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const files = walk(LOCAL);
  log(`增量文件数（${LOCAL} → ${REMOTE}/）: ${files.length}`);

  // 1) 获取当前 head + base_tree
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  const baseTree = headCommit.tree.sha;
  log(`当前 ${BRANCH} head: ${headSha}（tree ${baseTree}）`);

  // 2) 创建新 blobs
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const buf = fs.readFileSync(path.join(LOCAL, rel));
    const content = buf.toString('base64');
    const b = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content, encoding: 'base64' });
    entries.push({ path: `${REMOTE}/${rel}`, mode: '100644', type: 'blob', sha: b.sha });
    if ((i + 1) % 20 === 0 || i + 1 === files.length) log(`  blob ${i + 1}/${files.length}`);
  }

  // 3) 基于 base_tree 创建增量 tree（base_tree 自动保留未涉及的文件）
  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseTree,
    tree: entries,
  });
  log(`新 tree: ${tree.sha}（${entries.length} 个变更）`);

  // 4) 创建 commit
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `site: 更新 ${REMOTE}/（Git Data API 增量推送）`,
    tree: tree.sha,
    parents: [headSha],
  });
  log(`新 commit: ${commit.sha}`);

  // 5) 更新 ref
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  log(`已更新 ${BRANCH} -> ${commit.sha}`);

  // 6) 触发 Pages 构建
  try {
    const build = await api('POST', `/repos/${OWNER}/${REPO}/pages/builds`, {});
    log(`Pages 构建状态: ${build.status || 'queued'}`);
  } catch (e) {
    log(`触发 Pages 构建失败（不影响 push）: ${e.message}`);
  }

  log(`站点: https://${OWNER}.github.io/${REPO}/${REMOTE}/`);
}
main().catch(e => { console.error('PUSH FAILED:', e.message); process.exit(1); });
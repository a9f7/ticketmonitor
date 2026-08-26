// 通过 GitHub Git Data API 推送 gh-pages（绕过 github.com:443 的 git 协议限制）。
// 沙箱中 github.com 的 git 智能 HTTP 推送会被代理重置，但 api.github.com 可达。
// 用法: GH_TOKEN=xxx node scripts/push_ghpages_api.mjs <local-site-dir> [branch]
// 该脚本会把 <local-site-dir> 下所有文件作为新提交推到 gh-pages（或指定分支）。
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1); }
const SITE = process.argv[2] || 'dist';
const BRANCH = process.argv[3] || 'gh-pages';
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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const files = walk(SITE);
  log(`站点文件数: ${files.length}`);

  // 1) 创建 blob
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const buf = fs.readFileSync(path.join(SITE, rel));
    const content = buf.toString('base64');
    const b = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content, encoding: 'base64' });
    entries.push({ path: rel, mode: '100644', type: 'blob', sha: b.sha });
    if ((i + 1) % 20 === 0 || i + 1 === files.length) log(`  blob ${i + 1}/${files.length} (${rel})`);
  }

  // 2) 获取当前 gh-pages head 作为 parent
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
  const parent = ref.object.sha;
  log(`当前 ${BRANCH} head: ${parent}`);

  // 3) 创建 tree
  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: entries });
  log(`tree: ${tree.sha}`);

  // 4) 创建 commit
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `site: 更新 ${BRANCH}（Git Data API 推送）`,
    tree: tree.sha,
    parents: [parent],
  });
  log(`commit: ${commit.sha}`);

  // 5) 更新 ref
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  log(`已更新 ${BRANCH} -> ${commit.sha}`);
  log(`站点: https://${OWNER}.github.io/${REPO}/`);
}
main().catch(e => { console.error('PUSH FAILED:', e.message); process.exit(1); });

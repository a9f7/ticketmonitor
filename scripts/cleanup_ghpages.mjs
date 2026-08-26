// 删除 gh-pages 分支上的指定路径文件（用于清理 push 失误嵌套的子目录）
// 用法: GH_TOKEN=xxx node scripts/cleanup_ghpages.mjs <path1> [path2] ... [branch]
import fs from 'fs';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1); }
const PATHS = process.argv.slice(2, -1);
const BRANCH = process.argv[process.argv.length - 1] || 'gh-pages';
const OWNER = 'a9f7';
const REPO = 'ticketmonitor';
const API = 'https://api.github.com';
const auth = { Authorization: `Bearer ${TOKEN}` };
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

async function api(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method, headers: { ...auth, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json', 'User-Agent': 'workbuddy-cleanup' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function shouldDelete(path) {
  return PATHS.some(p => path === p || path.startsWith(p + '/'));
}

async function main() {
  log(`将清理 ${PATHS.length} 个路径下的所有 blob/tree 于 ${BRANCH} 分支`);
  for (const p of PATHS) log(`  清理: ${p}/`);

  // 1) 拿当前 head + base_tree
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  const baseTreeSha = headCommit.tree.sha;
  log(`当前 ${BRANCH} head: ${headSha.slice(0,12)}（tree ${baseTreeSha.slice(0,12)}）`);

  // 2) 拉取整棵树（recursive），决定哪些 blob / 空 tree 要删
  const baseTree = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}?recursive=1`);
  const changes = [];
  const removed = [];
  for (const entry of baseTree.tree) {
    if (!shouldDelete(entry.path)) continue;
    if (entry.type === 'blob') {
      removed.push(entry.path);
      changes.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: null });
    } else if (entry.type === 'tree') {
      // 仅当该 subtree 下所有 blob 都被删时才删除该 tree
      const subBlobs = baseTree.tree.filter(c => c.type === 'blob' && c.path.startsWith(entry.path + '/'));
      const allDeleted = subBlobs.every(b => shouldDelete(b.path));
      if (allDeleted) {
        removed.push(entry.path);
        changes.push({ path: entry.path, mode: entry.mode, type: 'tree', sha: null });
      }
    }
  }
  if (!removed.length) { log('没有可清理的文件'); return; }
  log(`待删除 ${removed.length} 项`);

  // 3) 创建新 tree（基于 base_tree，仅传删除项）
  const t = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseTreeSha,
    tree: changes,
  });
  log(`新 tree: ${t.sha.slice(0,12)}`);

  // 4) commit + 更新 ref
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `site: 清理 ${PATHS.join(', ')}`,
    tree: t.sha, parents: [headSha],
  });
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  log(`已更新 ${BRANCH} -> ${commit.sha.slice(0,12)}`);

  // 5) 触发 Pages 构建
  try {
    const build = await api('POST', `/repos/${OWNER}/${REPO}/pages/builds`, {});
    log(`Pages 构建状态: ${build.status || 'queued'}`);
  } catch (e) {
    log(`触发 Pages 构建失败: ${e.message}`);
  }
}
main().catch(e => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });
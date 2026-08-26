// 通过 GitHub Contents API 把指定源文件推送到 master 分支（逐个文件提交，自动处理新增/更新）。
// 绕过 github.com 智能 HTTP 推送被代理重置的问题，且比 Git Data API 的 tree 创建更稳（不会 404）。
// 用法: GH_TOKEN=xxx node scripts/push_master_api.mjs <repo相对路径1> [<路径2> ...]
import fs from 'fs';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1); }
const OWNER = 'a9f7';
const REPO = 'ticketmonitor';
const BRANCH = 'master';
const API = 'https://api.github.com';
const auth = { Authorization: `Bearer ${TOKEN}` };
const log = (...a) => process.stderr.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json', 'User-Agent': 'workbuddy-src-push' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${p}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function getSha(path) {
  try {
    const r = await api('GET', `/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`);
    return r.sha;
  } catch (e) {
    if (e.message.includes('HTTP 404')) return null; // 文件不存在 = 新增
    throw e;
  }
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node push_master_api.mjs <files...>'); process.exit(1); }
  for (const f of files) {
    const content = fs.readFileSync(f).toString('base64');
    const sha = await getSha(f);
    const body = { message: `chore: 同步 ${f}（云端双保险）`, content, branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${encodeURI(f)}`, body);
    log(`  ${sha ? 'update' : 'create'} ${f} -> commit ${r.commit.sha.slice(0, 8)}`);
  }
  log(`完成。master: https://github.com/${OWNER}/${REPO}/commits/${BRANCH}`);
}

main().catch(e => { console.error('PUSH FAILED:', e.message); process.exit(1); });

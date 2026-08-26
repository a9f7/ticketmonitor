#!/usr/bin/env bash
# CloudStudio 云端运行器：由工作区内 crontab 每 12h 调用，跑管线并推送 gh-pages。
# 设计目标：完全自包含、无需本机、可在任意 Linux 容器（CloudStudio 工作区）跑。
#
# 环境变量（必须在运行环境里预先设置）：
#   GH_TOKEN    GitHub Personal Access Token（repo 范围，用于推送 gh-pages）。也可用 GH_PAT 别名。
#   SKIP_DETAIL 可选，=1 时仅跑日历低价模式（最稳、最不易被 Trip.com 反爬拦，但无航班号/航司）。
#               不设置则走「自动降级」：先试完整详单，被 whaleguard 拦自动转日历模式。
#
# 用法：
#   bash scripts/cloud_run.sh
#   SKIP_DETAIL=1 bash scripts/cloud_run.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG="$LOG_DIR/cloud_run_$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

echo "==================== [$(date)] cloud_run start ===================="
echo "SKIP_DETAIL = ${SKIP_DETAIL:-0}"
echo "GH_TOKEN    = ${GH_TOKEN:+set}${GH_TOKEN:-${GH_PAT:+set(PAT)}}"
node --version 2>&1 || { echo "ERROR: node 不可用，请先在工作区安装 Node >=18（推荐 22）"; exit 1; }

# 依赖：仅首次或 package.json 变更时安装（pipeline 实际只用到 Node 标准库 + fetch，
# puppeteer-core 虽声明但管线未使用，npm install 不会下载 Chromium）。
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "[$(date)] npm install ..."
  npm install --no-audit --no-fund
fi

# 跑管线（pipeline.js 末尾会自动把有效数据推送 gh-pages，需 GH_TOKEN）
GH_TOKEN="${GH_TOKEN:-$GH_PAT}" \
SKIP_DETAIL="${SKIP_DETAIL:-0}" \
  node scripts/pipeline.js

echo "==================== [$(date)] cloud_run done (exit $?) ===================="

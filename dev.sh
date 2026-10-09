#!/usr/bin/env bash
# 一键启动：后端(3001) + 前端(5173)，Ctrl+C 一起退出
set -e

cd "$(dirname "$0")"

# 任一进程退出则结束全部
cleanup() {
  echo ""
  echo "[dev] 正在停止全部进程..."
  # 先解除 trap，避免 kill 0 杀掉自身时再次触发 cleanup（刷屏）
  trap - INT TERM
  kill 0 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "[dev] 启动后端 (http://localhost:3001) 与前端 (http://localhost:5173)..."
echo "[dev] 按 Ctrl+C 停止全部"

npm --prefix server run dev &
npm --prefix frontend run dev &

wait

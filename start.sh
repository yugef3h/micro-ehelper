#!/bin/bash
set -e

# 自动清理旧端口进程
for port in 8888 8080; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "Killing old process on port $port (PID $pid)"
    kill -9 $pid 2>/dev/null || true
    sleep 0.5
  fi
done

echo "Starting v2mock..."
echo ""

# 启动 Mock Server (后台)
cd "$(dirname "$0")/mock-server"
node server.js &
MOCK_PID=$!

# 等 Mock Server 就绪
sleep 1

# 启动 Vue Demo (前台，Ctrl+C 终止)
cd "$(dirname "$0")/demo-frontend"
npx vue-cli-service serve --open &
VUE_PID=$!

# 捕获 Ctrl+C，同时杀掉两个进程
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $MOCK_PID 2>/dev/null || true
  kill $VUE_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait

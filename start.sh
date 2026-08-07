#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-direct}"
CONFIG="$SCRIPT_DIR/v2mock.config.json"

# ============================================================
# 读取配置
# ============================================================
MOCK_PORT=$(node -e "console.log(require('$CONFIG').mock.port)")
WHISTLE_PORT=$(node -e "console.log(require('$CONFIG').whistle.port)")
DEMO_PORT=$(node -e "console.log(require('$CONFIG').demo.port)")
DEMO_DOMAIN=$(node -e "console.log(require('$CONFIG').demo.domain)")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# ============================================================
# 清理旧端口
# ============================================================
cleanup_ports() {
  for port in $MOCK_PORT $DEMO_PORT; do
    pid=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pid" ]; then
      kill -9 $pid 2>/dev/null || true
      sleep 0.3
    fi
  done
}

# ============================================================
# 校验 1: 依赖是否安装
# ============================================================
check_deps() {
  echo "--- 依赖检查 ---"

  if [ ! -d "$SCRIPT_DIR/mock-server/node_modules" ]; then
    warn "mock-server 依赖未安装，正在安装..."
    cd "$SCRIPT_DIR/mock-server" && npm install --silent
    pass "mock-server 依赖已安装"
  else
    pass "mock-server"
  fi

  if [ ! -d "$SCRIPT_DIR/demo-frontend/node_modules" ]; then
    warn "demo-frontend 依赖未安装，正在安装..."
    cd "$SCRIPT_DIR/demo-frontend" && npm install --silent
    pass "demo-frontend 依赖已安装"
  else
    pass "demo-frontend"
  fi
}

# ============================================================
# 校验 2: Whistle (仅 whistle 模式)
# ============================================================
check_whistle() {
  echo "--- Whistle 检查 ---"

  # 是否安装
  if ! command -v w2 &>/dev/null; then
    fail "w2 未安装，请执行: npm install -g whistle"
    exit 1
  fi
  pass "w2 已安装"

  # 是否在运行
  if ! curl -s -o /dev/null "http://127.0.0.1:$WHISTLE_PORT"; then
    warn "Whistle 未运行，正在启动..."
    w2 start 2>&1 | tail -1
    sleep 1
    if ! curl -s -o /dev/null "http://127.0.0.1:$WHISTLE_PORT"; then
      fail "Whistle 启动失败"
      exit 1
    fi
  fi
  pass "Whistle 运行中 (:$WHISTLE_PORT)"

  # HTTPS 证书
  if ! curl -s -x "http://127.0.0.1:$WHISTLE_PORT" -k -o /dev/null "https://$DEMO_DOMAIN" 2>/dev/null; then
    warn "HTTPS 证书未安装或无效，尝试安装..."
    w2 ca 2>&1 | tail -1
    pass "HTTPS 证书已安装（请信任系统弹窗中的证书）"
  else
    pass "HTTPS 证书 OK"
  fi

  # 同步规则（多条规则合并进 v2mock 一个规则集，whistle 同时只激活一个规则集）
  echo "--- Whistle 规则同步 ---"
  local rule_value=$(node -e "
    const rules = require('$CONFIG').whistle.rules;
    console.log(rules.map(r => r.domain + ' ' + r.target).join('\n'));
  ")

  # 检查是否已有同名规则
  local existing=$(curl -s "http://127.0.0.1:$WHISTLE_PORT/cgi-bin/rules/list" | \
    node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const r=d.list.find(r=>r.name==='v2mock');console.log(r?r.data:'')")

  if [ "$existing" = "$rule_value" ]; then
    pass "规则已匹配:"
    echo "$rule_value" | sed 's/^/    /'
  else
    warn "更新规则:"
    echo "$rule_value" | sed 's/^/    /'
    curl -s -X POST "http://127.0.0.1:$WHISTLE_PORT/cgi-bin/rules/add" \
      --data-urlencode "name=v2mock" \
      --data-urlencode "value=$rule_value" \
      --data-urlencode "selected=true" > /dev/null
    pass "规则已同步"
  fi
}

# ============================================================
# 启动
# ============================================================
start_all() {
  echo ""
  echo "========================================="
  echo "  v2mock 启动 (mode: $MODE)"
  echo "========================================="
  echo ""

  cleanup_ports
  check_deps

  if [ "$MODE" = "whistle" ]; then
    check_whistle
    echo ""
    echo "--- 请确认 SwitchyOmega3 ---"
    echo "  1. Chrome 安装 SwitchyOmega3 扩展"
    echo "  2. 新建情景模式 'Whistle': HTTP 127.0.0.1:$WHISTLE_PORT"
    echo "  3. 新建 'auto switch': *.example.com → Whistle, localhost → 直连"
    echo "  4. 切换到 'auto switch'"
    echo ""

    VUE_MODE="whistle"
  else
    echo ""
    echo "--- 新项目直连模式 ---"
    echo "  DevServer proxy → localhost:$MOCK_PORT"
    echo ""
    VUE_MODE="direct"
  fi

  # 启动 Mock Server
  cd "$SCRIPT_DIR/mock-server"
  node server.js &
  MOCK_PID=$!
  sleep 1
  pass "Mock Server 已启动 (:$MOCK_PORT)"

  # 启动 Vue Demo
  cd "$SCRIPT_DIR/demo-frontend"
  npx vue-cli-service serve --mode "$VUE_MODE" --open &
  VUE_PID=$!

  echo ""
  echo "--- 面板地址 ---"
  echo "  Demo:     http://localhost:$DEMO_PORT"
  echo "  Admin:    http://localhost:$MOCK_PORT/__admin"
  echo "  Whistle:  http://127.0.0.1:$WHISTLE_PORT"
  echo ""
  echo "按 Ctrl+C 停止所有服务"
  echo ""

  # 等待并清理
  cleanup() {
    echo ""
    echo "Shutting down..."
    kill $MOCK_PID 2>/dev/null || true
    kill $VUE_PID 2>/dev/null || true
    exit 0
  }
  trap cleanup INT TERM
  wait
}

start_all

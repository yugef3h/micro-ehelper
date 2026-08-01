# v2mock-server

Standalone Mock Server with visual Admin UI. Framework-agnostic, Git-friendly.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:8888/__admin
```

## 目录结构

```
mock-server/
│
├── server.js                    # 入口：Express 进程，串联所有中间件
├── package.json                 # 依赖：express / mockjs / chokidar / http-proxy-middleware
├── mock.config.js               # 可选：非 Mock 请求的代理回退目标（未匹配时透传到真实后端）
│
├── src/                         # 核心逻辑（5 个模块，各管一件事）
│   ├── config.js                #   配置读写：_env.json（环境）和 _state.json（全局状态）
│   ├── router.js                #   路由匹配：URL 路径 → mocks-data/ 文件，8 级优先级查找
│   ├── handler.js               #   请求处理：JSON 文件→mockjs 展开 / JS 文件→动态执行
│   ├── middleware.js             #   Express 中间件：收请求 → 调 router → 调 handler → 返回
│   ├── admin-api.js             #   Admin 后端 API：/__admin/api/* (文件CRUD/环境切换/预览)
│   ├── proxy.js                 #   代理回退：未命中 Mock 时转发到真实后端（读 mock.config.js）
│   └── watcher.js               #   热更新：chokidar 监听 mocks-data/ 变动，自动清 JS 缓存
│
├── admin/                       # Admin 管理界面（纯 HTML/CSS/JS，零依赖 SPA）
│   ├── index.html               #   页面结构：左侧文件树 + 右侧 JSON 编辑器 + 底部预览
│   ├── app.js                   #   主逻辑：加载文件树、编辑、保存、环境切换、预览请求
│   └── style.css                #   暗色主题样式
│
├── mocks-data/                  # Mock 数据（JSON/JS 文件，Git 共享）
│   ├── _env.json                #   环境配置 {"current":"dev","envs":["dev","qa","prod"]}
│   ├── _state.json              #   跨接口共享状态（Admin 可编辑）
│   ├── _all.json                #   全局兜底：任何未匹配的请求都返回这个
│   └── api/                     #   对应 /api/* 路径
│       ├── _all.json            #     前缀兜底：/api/xxx 未匹配时返回
│       ├── user_info/           #     多环境示例（文件名=endpoint，子目录=环境）
│       │   ├── dev.json         #       DEV 环境数据
│       │   ├── qa.json          #       QA 环境数据
│       │   └── prod.json        #       PROD 环境数据
│       └── order_list/          #     动态 JS Mock 示例
│           └── dev.js           #       可读 _state.json，模拟延迟，生成随机数据
│
└── mock-utils/                  # 共享工具（预留，给 JS Mock 文件 require 用）
    └── constant.js
```

### 请求处理流程

```
浏览器请求 GET /api/user_info
  │
  ▼
server.js  Express 收请求
  │
  ▼
middleware.js  调 router.js 查找文件
  │
  ▼
router.js  按优先级遍历:
  1. api/user_info/dev.js        ← 动态脚本(当前环境)
  2. api/user_info/dev.json      ← 静态数据(当前环境)
  3. api/user_info.js            ← 动态脚本(通用)
  4. api/user_info.json          ← 静态数据(通用)
  5. api/_all.js                 ← 前缀兜底
  6. api/_all.json
  7. _all.js                     ← 全局兜底
  8. _all.json
  → 命中: api/user_info/dev.json
  │
  ▼
handler.js  读文件 → JSON.parse → Mock.mock() 展开 @cname, @boolean 等
  │
  ▼
res.json({ code:"0000", data: { name:"张三", ... } })
```

## Mock File Formats

**JSON** — static data with mockjs syntax:
```json
{
  "code": "0000",
  "data": {
    "name": "@cname",
    "items|2-3": [{ "id": "@id" }],
    "role|1": ["ADMIN", "USER"]
  }
}
```

**JS** — dynamic logic with state access:
```js
const Mock = require('mockjs');
module.exports = async function(req, res, state) {
  await new Promise(r => setTimeout(r, 200));
  res.json(Mock.mock({ code: '0000', data: { enabled: state.featureEnabled } }));
};
```

## Route Matching Priority

Request `GET /api/user_info` resolves (high → low):

| Priority | File |
|----------|------|
| 1 | `api/user_info/{env}.js` |
| 2 | `api/user_info/{env}.json` |
| 3 | `api/user_info.js` |
| 4 | `api/user_info.json` |
| 5 | `api/_all.js` |
| 6 | `api/_all.json` |
| 7 | `_all.js` |
| 8 | `_all.json` |
| — | Proxy fallback or 404 |

## 当前实现链路（新项目直连模式，无需 Whistle）

```
浏览器打开 http://localhost:8080
  │
  ▼
Vue Demo (Webpack DevServer :8080)
  │  axios 拦截器加 /api 前缀 → 请求 /api/user_info
  │
  ▼
DevServer proxy 匹配 "/api" 规则
  → target: http://localhost:8888
  → changeOrigin: true
  │
  ▼
Mock Server (Express :8888)
  │  router.js 按 8 级优先级查找 mocks-data/ 目录
  │  handler.js 读 JSON → Mock.mock() 解析 @cname、@boolean 等语法
  │  JS 文件则 require() 执行动态逻辑，可访问全局 state
  │
  ▼
返回 Mock 数据 → Vue Demo 实时展示
```

**关键：axios 使用相对路径（`/user_info`），全程 localhost。DevServer proxy 直接转发，不需要 Whistle。**

### 旧项目接入（需要 Whistle + SwitchyOmega3）

旧项目 axios 写死外部域名 baseURL（如 `https://api.example.com`）。请求目标是外部域名，必须经过系统代理层拦截。

**请求链路：**

```
Vue Demo (localhost:8080)
  │  axios baseURL = https://api.example.com
  │  请求 GET /api/user_info
  │  实际发出: https://api.example.com/api/user_info
  │
  ▼  浏览器解析 api.example.com → 非 localhost
SwitchyOmega3: 转发到 Whistle (127.0.0.1:8899)
  │
  ▼
Whistle: 匹配规则 api.example.com → localhost:8888
  │  解密 HTTPS，转发 HTTP 到 Mock Server
  │
  ▼
Mock Server (localhost:8888)
  │  匹配 mocks-data/api/user_info/dev.json
  │  返回 Mock 数据
```

**Whistle 规则：**

```
api.example.com  localhost:8888
```

**SwitchyOmega3 配置：**

```
SwitchyOmega3 的 Auto Switch
  模式可以按域名自动分流，不用手动切。配置方式：

  1. 先创建一个 Whistle 代理情景模式（如果还没有）：

  情景模式名: Whistle
  类型: 代理服务器
  协议: HTTP
  服务器: 127.0.0.1
  端口: 8899

  2. 创建 Auto Switch 情景模式：

  情景模式名: auto switch
  类型: 自动切换模式

  规则列表:
    ┌─────────────────────────────────────────────────────────────┐
    │ 条件类型        │ 条件详情              │ 情景模式     │
    ├─────────────────────────────────────────────────────────────┤
    │ 域名通配符      │ *.example.com         │ Whistle     │
    │ 域名通配符      │ localhost             │ 直接连接    │
    │ 域名通配符      │ 127.0.0.1             │ 直接连接    │
    │ 域名通配符      │ 192.168.*             │ 直接连接    │
    │ 默认           │ *                     │ 直接连接    │
    └─────────────────────────────────────────────────────────────┘

  3. 浏览器切换到 auto switch 情景模式

  效果：
  - 访问 localhost:8080 → 直连（DevServer 页面正常加载）
  - 访问 api.example.com → 自动走 Whistle → Mock Server
  - 访问其他任何网站 → 直连（不影响日常上网）

  这样不用在"直接连接"和"代理模式"之间手动切，全自动。
```

**启动：**

```bash
# 1. 安装 Whistle HTTPS 证书（首次）
w2 ca

# 2. 配置 Whistle 规则（首次，或通过 Web UI http://127.0.0.1:8899）
curl -X POST http://127.0.0.1:8899/cgi-bin/rules/add \
  -d "name=v2mock&value=api.example.com%20localhost:8888&selected=true"

# 3. Chrome 配置 SwitchyOmega3

# 4. 启动
w2 start
npm run dev:whistle
```

### Vue3 + Vite (direct proxy)

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8888',
      '/open/api': 'http://localhost:8888',
    }
  }
})
```

## Admin API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/__admin/api/tree` | Directory tree |
| GET | `/__admin/api/file?path=` | Read file |
| POST | `/__admin/api/file` | Create/update file |
| DELETE | `/__admin/api/file?path=` | Delete file |
| GET | `/__admin/api/state` | Read state |
| POST | `/__admin/api/state` | Update state |
| GET | `/__admin/api/env` | Read env config |
| POST | `/__admin/api/env` | Switch env |
| POST | `/__admin/api/preview` | Preview mock response |

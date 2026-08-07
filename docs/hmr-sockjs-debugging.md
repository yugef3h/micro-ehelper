# HMR sockjs 在 Whistle 代理 / https 下的排查与修复

> 场景：本地 Demo 的接口请求经 ZeroOmega(SwitchyOmega) → Whistle(8899) → 真实外部 API，同时要保证 devServer 的 HMR（sockjs-node WebSocket）正常工作。
> 本文记录了完整链路搭建、踩过的三个坑，以及最核心的「页面 https 下 sockjs 报 `ERR_SSL_PROTOCOL_ERROR`」的根因与修复。

---

## 目标链路

```
浏览器
 ├─ API 请求  → api.example.com    → omega → whistle(8899) → https://jsonplaceholder.typicode.com（真实外网）
 ├─ 页面(可选) → demo.example.com   → omega → whistle(8899) → localhost:8080（devserver，whistle 终结 TLS）
 └─ HMR sockjs → {sockjs host}/sockjs-node（见文末「坑三」，必须让它走 whistle）
```

当前 whistle 规则（合并进 `v2mock` 一个规则集，见「坑一」）：

```
api.example.com https://jsonplaceholder.typicode.com
demo.example.com localhost:8080
```

### 找一个可用的外部 API

本机实测（2026-08）：

| API | 结果 |
|---|---|
| **jsonplaceholder.typicode.com** | ✅ 200，免鉴权，CORS 友好，REST 结构清晰 |
| httpbin.org | ❌ 503 |
| reqres.in | ❌ 401 要求 x-api-key |
| api.github.com | ⚠️ 200 但要 User-Agent 头 + 限流 |

> 用**域名**做 whistle 目标，别用硬编码 IP：jsonplaceholder 在 Fastly CDN 后，IP 会轮换，且 HTTPS/SNI 下硬编码 IP 很脆。

---

## 坑一：whistle 规则集「同时只激活一个」，同步时被互相反选

**症状**：接口突然全部 502，whistle 报 `DNS Lookup Failed` / `Error: queryA ENODATA api.example.com`。

**原因**：whistle 的 Rules 里多个规则集同时只有一个处于 `selected`。用 `selected=true` 添加/更新一条规则，会把其他规则集**反选**。此时 `api.example.com` 没有激活的规则命中 → whistle 把 `api.example.com` 当**真实域名**去 DNS 解析 → 解析失败 → 502。

**修复**：
1. 所有规则合并进**同一个**规则集（如 `v2mock`），一次性同步，只选一个。
2. `start.sh` 原实现是「遍历 config 里每条规则、逐条以 `name=v2mock` 覆盖同步」，只支持单条规则，多条时后者覆盖前者。已改为**把全部规则拼成一个多行值**、作为单个规则集同步一次。

```bash
# start.sh 修复后的核心逻辑
local rule_value=$(node -e "
  const rules = require('$CONFIG').whistle.rules;
  console.log(rules.map(r => r.domain + ' ' + r.target).join('\n'));
")
curl -s -X POST "http://127.0.0.1:$WHISTLE_PORT/cgi-bin/rules/add" \
  --data-urlencode "name=v2mock" \
  --data-urlencode "value=$rule_value" \
  --data-urlencode "selected=true" > /dev/null
```

**排查**：`curl "http://127.0.0.1:8899/cgi-bin/rules/list"` 看每个规则集的 `selected` 标记与 `data`。

---

## 坑二：mock-server 的 `_all.js` 全局兜底会吞掉 proxyMap 转发

**症状**：配好了 `mock-server/mock.config.js` 的 `proxyMap`，但请求没有转发到外部，返回的是 `_all.js` 的「全局兜底响应」。

**原因**：`mock-server/src/router.js` 的 `resolveMockFile` 候选列表最后总带 `_all.js` / `_all.json`：

```js
const candidates = [
  endpoint ? `${endpoint}.js` : null,
  endpoint ? `${endpoint}.json` : null,
  '_all.js',     // ← 只要存在，任何未命中的请求都会命中它
  '_all.json',
];
```

`_all.js` 存在时，`mockMiddleware` 对任何未命中请求都返回 mock，`proxy.js` 的 proxy 路由**永远轮不到**。

**处理（测试 proxy 链时）**：
- 临时停用全局兜底：`mv mocks-data/_all.js mocks-data/_all.js.disabled`
- 恢复：`git mv mocks-data/_all.js.disabled mocks-data/_all.js`
- 之后未命中请求会落到 `proxyMap`，`/api` 前缀被剥掉后转发到外部。

---

## 坑三（核心）：页面 https 下 HMR sockjs 报 `ERR_SSL_PROTOCOL_ERROR`

### 症状

- 页面在 `https://demo.example.com` 打开，但 DevTools 里 sockjs 请求的是 `https://localhost:8080/sockjs-node/info`，报 `(failed) net::ERR_SSL_PROTOCOL_ERROR`。
- 换成 `http://localhost:8080` 打开页面，HMR 就正常。

### 根因（wds 3.x 源码层）

**wds 3.x 的 sockjs 客户端地址是「devserver 启动时烘焙进 bundle」的，host 是写死的，运行时并不跟随页面域名。** 分三步：

**① `createDomain.js` 生成烘焙域名**（`devServer.host` + `port`）：

```js
const protocol = options.https ? 'https' : 'http';  // 本项目 https:false → 'http'
const hostname = options.host || 'localhost';        // vue.config host:'localhost'
const port     = server.address().port;              // 8080
// → 'http://localhost:8080'
```

**② `addEntries.js` 把它注入 client 入口**：

```js
const clientEntry = `${require.resolve('../../client/')}?${domain}`;
// bundle 里写死: client/index.js?http://localhost:8080
```

**③ 浏览器运行时 `createSocketUrl.js` 用「烘焙 host + 页面协议」拼 URL**：

```js
var hostname = urlParts.hostname;  // 'localhost'  ← 烘焙的，死的
var protocol = urlParts.protocol;  // 'http:'
var port     = urlParts.port;      // '8080'

// 页面是 https 时协议强制升级（浏览器不允许 https 页面用 ws://）
if (hostname && hostname !== '127.0.0.1' && loc.protocol === 'https:') {
  protocol = loc.protocol;   // → 'https:'
}
// host / port 不变！
// → https://localhost:8080/sockjs-node
```

所以**无论你在哪个 https 域名打开页面，sockjs 都连 `https://localhost:8080`**。而 `localhost` 在 omega 里是直连、devserver 又是纯 HTTP（`https:false`）→ 浏览器对纯 HTTP 服务器发 TLS 握手 → `ERR_SSL_PROTOCOL_ERROR`。这**不是 devserver 挂了**，devserver 是好的（`http://localhost:8080/sockjs-node/info` 返回 200 `{"websocket":true,...}`）。

### 修复：`devServer.public` 覆盖烘焙 host

`public` 是 wds 3.x 专门留给「覆盖对外宣称域名」的开关，`createDomain` 会原样返回它：

```js
// demo-frontend/vue.config.js
devServer: {
  host: 'localhost',
  port: 8080,
  ...
  public: 'https://demo.example.com',   // 烘焙 host 从 localhost:8080 → demo.example.com
}
```

改完后 sockjs → `https://demo.example.com/sockjs-node`，经 omega 交给 whistle，whistle 终结 TLS 后转发给 devserver → 握手成功，HMR 正常。

> 为什么不能用 `devServer.host` 代替：`host` 控制 devserver **监听地址**（绑到 demo.example.com 会绑错 IP），`public` 控制**对外宣称的域名**，是两个概念。wds 3.x 没有「运行时跟随 `location.host`」的选项（4.x 才有 `client.webSocketURL`），`public` 是 3.x 唯一正解。

### 验证方法

```bash
# 1. 用 wds 真实 createSocketUrl 模拟修前/修后
node -e "
const c = require('./demo-frontend/node_modules/webpack-dev-server/client/utils/createSocketUrl');
console.log('修前:', c('?http://localhost:8080',      'https://demo.example.com/'));
console.log('修后:', c('?https://demo.example.com',   'https://demo.example.com/'));
"
# 修前: https://localhost:8080/sockjs-node
# 修后: https://demo.example.com/sockjs-node

# 2. 检查 bundle 里烘焙的 host（重启 devserver 后生效）
curl -s http://localhost:8080/js/chunk-vendors.js | grep -oE 'https?://[a-z0-9.:-]+' | sort -u

# 3. devserver 自身 sockjs 是否正常
curl -s "http://localhost:8080/sockjs-node/info?t=1"   # → {"websocket":true,...}
```

### sockjs 排查清单（按顺序）

1. **devserver 活着吗**：`http://localhost:8080/sockjs-node/info?t=1` 是否返回 `{"websocket":true,...}`。是 → devserver 没问题。
2. **sockjs 被代理了吗**：whistle 网络面板（`http://127.0.0.1:8899`）里有没有 `/sockjs-node` 请求。有 → 它走了 whistle；没有 → 它在直连。
3. **sockjs 目标对吗**：DevTools Network 里 `/sockjs-node/.../websocket` 是否 `101 Switching Protocols`。不是 101（pending/404/错误）→ 规则把 sockjs 转去了错误目标（如 API 规则误吞）。
4. **bundle 烘焙的 host**：grep `chunk-vendors.js` 里的 socket 域名，确认是 `demo.example.com` 而不是 `localhost:8080`。
5. **https 页面 + 直连 localhost 必挂**：`https://localhost:8080` 是纯 HTTP devserver，SSL 报错是预期行为，不是 devserver 问题。

---

## 概念澄清：页面 https ≠ 接口 https

「后端接口是 https」**不需要**页面是 https。旧项目（见 `PROXY-ARCHITECTURE.md`）devServer 就是 `https: false`，浏览器 → devserver 是 HTTP，devserver → 后端是 HTTPS（`devServer.proxy[].target: 'https://xxx'` 做 HTTP→HTTPS 桥接）。sockjs 只在**页面本身是 https** 时才需要处理协议升级问题。

真正需要页面 https 的场景：Secure cookie 只在 https 下发、接口校验 Origin/Referer 必须 https、OAuth 回调白名单、iframe 嵌入限制等。

---

## 相关文件

| 文件 | 本次改动 |
|---|---|
| `demo-frontend/vue.config.js` | devServer 加 `public: 'https://demo.example.com'`（修 sockjs 烘焙 host） |
| `v2mock.config.json` | whistle 规则指向外部 API + demo 域名规则 |
| `start.sh` | 修复多规则同步（合并成一个规则集） |
| `mock-server/src/router.js` | （未改，记录 `_all.js` 吞代理的坑） |
| `mock-server/mock.config.js` | proxyMap 测试后已还原为空 |

# Ehire 微前端项目 — 接口代理架构完整分析 & 最简复现指南

> **用途**：本文档详尽记录当前项目的技术栈、依赖版本、Webpack 配置、代理链路中每一个环节的配置细节，使你能在新项目中 1:1 照搬这套 Whistle + SwitchyOmega3 代理架构。
>
> **前提假设**：你的新项目不在公司内网，因此文档还提供了一套本地多环境 Mock 服务方案来替代后端。

---

## 一、完整技术栈 & 精确依赖版本

### 1.1 运行时环境

| 类别 | 技术 | 精确版本 | 备注 |
|------|------|----------|------|
| Node.js | — | **14.16.0** | engines 声明中指定 |
| 包管理 | pnpm | **7.33.3** | workspace monorepo，8.x 需要更高 Node 版本 |
| npm registry | — | `https://registry.npmmirror.com` | .npmrc 配置 |
| 内部 registry | @51job | `https://nexus.51job.com/repository/npm-public/` | 仅公司内网 |
| pnpm hoist | — | `hoist=true, shamefully-hoist=true` | **关键**：webpack 提升到根 node_modules |

### 1.2 框架 & 核心库

| 类别 | 包名 | 精确版本 |
|------|------|----------|
| 框架 | `vue` | **2.7.16** |
| 路由 | `vue-router` | **3.6.5** |
| 状态管理 | `vuex` | **3.6.2** |
| HTTP 客户端 | `axios` | **0.24.0** |
| 微前端 | `qiankun` | **2.10.12** |
| UI 组件库 | `@51job/element-ui` | **2.15.14** |
| CSS 预处理 | `node-sass` | **^4.12.0** |
| Sass loader | `sass-loader` | **^8.0.2** |

### 1.3 构建工具链（精确版本）

| 类别 | 包名 | 精确版本 | 安装位置 |
|------|------|----------|----------|
| CLI Service | `@vue/cli-service` | **4.5.19** | gaea/node_modules/@vue/cli-service |
| Babel Plugin | `@vue/cli-plugin-babel` | **~4.5.0** | |
| ESLint Plugin | `@vue/cli-plugin-eslint` | **~4.5.0** | |
| Webpack | `webpack` | **4.47.0** | **根 node_modules（hoisted）** |
| Dev Server | `webpack-dev-server` | **3.11.3** | **根 node_modules（hoisted）** |
| Webpack Chain | `webpack-chain` | **^6.4.0** | |
| Webpack Merge | `webpack-merge` | **^4.2.2** | |
| Babel | `@babel/polyfill` | **7.12.1** | |
| Babel | `core-js` | **^3.6.5** | |
| Babel Preset | `@babel/preset-env` | — | targets: `{ ie: 11, chrome: 58 }` |

### 1.4 代理链路涉及的关键依赖（承上启下）

这些包是 Webpack DevServer proxy 功能正常工作的底层核心，必须在 package.json 或 pnpm hoist 下可用：

| 包名 | 精确版本 | 在代理链路中的角色 |
|------|----------|-------------------|
| `http-proxy-middleware` | **1.3.1** | DevServer proxy 配置的实际执行者，由 webpack-dev-server 3.x 依赖 |
| `http-proxy` | **1.18.1** | http-proxy-middleware 的底层 HTTP 代理库 |
| `connect-history-api-fallback` | **1.6.0** | SPA history 模式路由回退（`historyApiFallback: true` 依赖此包） |
| `dotenv` | **8.6.0** | 加载 `.env.*` 文件到 `process.env` |
| `dotenv-expand` | **5.1.0** | 展开 `.env` 文件中的变量引用 |
| `sockjs-client` | — | HMR WebSocket 客户端（`hot: true` 的热更新依赖） |

### 1.5 环境变量加载机制

```
vue-cli-service serve --mode development
  ↓
Service.init(mode = 'development')
  ↓
loadEnv('development')  → 加载 .env.development.local → .env.development
  ↓
loadEnv()               → 加载 .env.local → .env
  ↓
dotenv.config() + dotenvExpand() 解析变量到 process.env
  ↓
只有 VUE_APP_ 前缀的变量会被 webpack.DefinePlugin 注入客户端代码
```

**当前项目 env 目录**（通过 symlink 链接到各子应用）：

```
env/
├── .env.development   # 本地开发（默认），NODE_ENV=development
├── .env.dev           # 开发环境部署，NODE_ENV=production
├── .env.test          # 测试环境，NODE_ENV=production
├── .env.qa            # QA 环境，NODE_ENV=production
├── .env.pre           # 预发布环境，NODE_ENV=production
└── .env.production    # 生产环境，NODE_ENV=production
```

**Symlink 机制**（由 `scripts/env-runner.js` 执行）：
```bash
# 每个子应用目录下：
.env.development -> ../env/.env.development
.env.dev         -> ../env/.env.dev
.env.production  -> ../env/.env.production
.env.qa          -> ../env/.env.qa
.env.test        -> ../env/.env.test
```

---

## 二、Webpack DevServer 完整配置拆解

### 2.1 所有子应用的 devServer 配置一览

| 配置项 | gaea (基座) | user | job | company | report |
|--------|-------------|------|-----|---------|--------|
| `host` | `localhost` | `localhost` | `localhost` | `localhost` | `localhost` |
| `port` | **6600** | **6601** | **6604** | **6602** | **6603** |
| `https` | false | false | false | false | false |
| `open` | false | false | false | false | false |
| `hot` | true | true | true | true | true |
| `hotOnly` | true | true | true | true | true |
| `disableHostCheck` | true | true | true | true | true |
| `historyApiFallback` | **true** | **{} (空对象)** | **{} (空对象)** | — | — |
| `headers` | `Access-Control-Allow-Origin: *` | 同 | 同 | 同 | 同 |
| `overlay.warnings` | false | false | false | false | false |
| `overlay.errors` | true | true | true | true | true |

### 2.2 devServer 各配置项详细说明（与代理链路的关系）

```javascript
// 来自 gaea/vue.config.js — 逐项解释
devServer: {
  // ① overlay: 编译错误时浏览器弹遮罩层，不影响代理
  overlay: {
    warnings: false,   // 警告不弹窗
    errors: true       // 错误弹窗
  },

  // ② host: DevServer 监听的域名/IP
  //    影响：设为 localhost 时，Chrome 认为 localhost 是安全上下文
  //    如果改成 0.0.0.0，需要用 IP 访问
  host: 'localhost',

  // ③ port: DevServer 监听的端口
  port: 6600,

  // ④ https: 是否启用 HTTPS
  //    当前项目关闭，DevServer HTTP → proxy target 是 HTTPS
  //    跨协议代理需要 http-proxy 处理 TLS
  https: false,

  // ⑤ open: 启动时是否自动打开浏览器
  open: false,

  // ⑥ hot + hotOnly: HMR (热模块替换)
  //    通过 WebSocket (sockjs) 推送更新
  //    请求走 DevServer 直连，不经过 proxy
  hot: true,
  hotOnly: true,   // HMR 失败时不刷新整个页面

  // ⑦ disableHostCheck: 跳过 Host 头检查
  //    【微前端必须】qiankun 加载子应用时 Host 头可能不对
  //    注意：webpack-dev-server 4.x 中此选项变为 allowedHosts: 'all'
  disableHostCheck: true,

  // ⑧ historyApiFallback: SPA 路由回退
  //    gaea 设为 true：所有 404 回退到 index.html
  //    子应用设为 {}：保留默认行为，但使用空配置对象而非 boolean
  historyApiFallback: true,

  // ⑨ headers: 所有响应添加的 HTTP 头
  //    【微前端必须】子应用的 JS/CSS 被基座跨域加载需要这个头
  headers: {
    'Access-Control-Allow-Origin': '*'
  },

  // ⑩ proxy: 核心 — 下面单独展开
  proxy: { ... }
}
```

### 2.3 proxy 配置详解（每条规则的作用）

```javascript
proxy: {
  // ===== /api → ehirej.51job.com (主业务接口) =====
  '/api': {
    target: 'https://ehirej.51job.com',
    // ① 为什么是 HTTPS target？
    //    线上后端是 HTTPS，DevServer 用 http-proxy 做 HTTP→HTTPS 桥接
    //    这样浏览器到 DevServer 是 HTTP（无需证书），DevServer 到后端是 HTTPS

    changeOrigin: true,
    // ② 【最关键】把请求头 Host 从 localhost:6600 改为 ehirej.51job.com
    //    因为 Whistle 按 Host 头匹配规则
    //    如果 Host = localhost:6600 → Whistle 规则中的 ehirej.51job.com 匹配不到 → 代理无效

    pathRewrite: { '^/api': '' }
    // ③ 去掉 /api 前缀
    //    前端请求: /api/user/info
    //    后端收到: /user/info
    //    线上 Nginx 同样做这个重写
  },

  // ===== /openapi → open.51job.com (开放平台接口) =====
  '/openapi': {
    target: 'https://open.51job.com',
    changeOrigin: true,
    pathRewrite: { '^/openapi': '' }
  },

  // ===== /mehireapi → mehireapi.51job.com =====
  '/mehireapi': {
    target: 'https://mehireapi.51job.com',
    secure: false,        // ④ 跳过 SSL 证书验证（内部域名证书可能不匹配）
    changeOrigin: true,
    pathRewrite: { '^/mehireapi': '' }
  },

  // ===== /weixinapi → m.51job.com (微信接口) =====
  '/weixinapi': {
    target: 'https://m.51job.com',
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/weixinapi': '' }
  },

  // ===== /mallapi → mallapi.51job.com (商城接口) =====
  '/mallapi': {
    target: 'https://mallapi.51job.com',
    changeOrigin: true,
    pathRewrite: { '^/mallapi': '' }
  },

  // ===== /mockapi → yapi.51job.com (YAPI Mock) =====
  '/mockapi': {
    target: 'http://yapi.51job.com',   // ⑤ 注意：这个是 HTTP
    changeOrigin: true,
    pathRewrite: { '^/mockapi': '' }
  },

  // ===== /vibeapi → vibe.51job.com (SSE/AI 接口，仅 gaea 有) =====
  '/vibeapi': {
    target: 'https://vibe.51job.com',
    secure: true,        // ⑥ 严格验证 SSL 证书
    changeOrigin: true,
    pathRewrite: { '^/vibeapi': '' }
  }
}
```

### 2.4 publicPath 配置（影响子应用资源加载）

```javascript
// gaea (基座) — 本地开发时 publicPath = '/'
publicPath: process.env.NODE_ENV === 'production'
  ? `${process.env.VUE_APP_STATICS_PATH}/micro/gaea/`
  : '/'

// user (子应用) — 本地开发时 publicPath = 'http://localhost:6601/'
// 【注意】子应用必须写完整 localhost URL，因为 qiankun 通过 fetch 加载子应用资源
publicPath: process.env.NODE_ENV === 'production'
  ? `${process.env.VUE_APP_STATICS_PATH}/micro/user/`
  : 'http://localhost:6601/'
```

---

## 三、axios 实例 & API 服务层完整分析

### 3.1 API 域名常量定义

```javascript
// base/constants/api/api-domain/index.js
export const domain = {
  VUE_APP_JAVA_API: {
    address: 'https://ehirej.51job.com',     // 主业务接口
    timeout: '10000',
    signKey: 'sfhVda5dsmZf'
  },
  VUE_APP_51JOB_API: {
    address: 'https://cupid.51job.com',       // 51job 开放接口
    timeout: '10000',
    signKey: '80d285e4d7e2c68e2d8c5453a2f08e61ea632589a037335cf18b066e6c16c642',
    apiKey: 'ehire'
  },
  VUE_APP_EHIRE_OPEN_API: {
    address: 'https://open.51job.com',        // 网才开放平台
    timeout: '60000',
    signKey: 'sfhVda5dsmZf'
  },
  VUE_APP_EHIRE_MEHIRE_API: {
    address: 'https://mehireapi.51job.com',
    timeout: '10000',
    signKey: 'ehr*q0lQr93RP#G19s',
    source: '03bec011e6bf92cb3fe6fac12a7cd62c',
    version: '999999'
  },
  VUE_APP_MALL_API: {
    address: 'https://mallapi.51job.com',
    timeout: '10000'
  },
  VUE_APP_SSE_API: {
    address: 'https://vibe.51job.com',
    timeout: '10000',
    signKey: 'sfhVda5dsmZf'
  },
  VUE_APPEAL_API: {
    address: 'https://rcapi.51job.com',
    timeout: '10000'
  }
}
```

### 3.2 两种 API 请求路径（对应代理链路的不同分支）

#### 路径 A：通过 DevServer proxy 转发的请求

```javascript
// base/apis/job/index.js 中的典型调用
export function getWYTData(code) {
  return apiService({
    method: 'post',
    url: '/order/contract/get_allopatry_gasset_contract',
    data: code,
    // 【关键】仅开发环境：覆盖 baseURL 为 '/api'
    // 生产环境：不注入此配置，使用 apiService 默认的 baseURL
    ...(process.env.NODE_ENV !== 'production' && { baseURL: '/api' })
  })
}

// apiService 的定义（base/utils/api/services/index.js）
const service = axios.create({
  baseURL: domain.VUE_APP_JAVA_API.address,   // 'https://ehirej.51job.com'
  timeout: 0,
  headers: commonHeaders
})
```

**此路径的完整链路**：
```
apiService({ baseURL: '/api', url: '/order/contract/...' })
  → 实际 URL: /api/order/contract/...
  → 浏览器按当前 origin 解析: http://localhost:6600/api/order/contract/...
  → DevServer proxy 匹配 '/api' 规则
  → 改 Host 为 ehirej.51job.com，去前缀
  → 请求发给 https://ehirej.51job.com/order/contract/...
  → SwitchyOmega3 查到目标不是 localhost → 转发到 Whistle
  → Whistle 查 ehirej.51job.com 规则 → 转发到后端 IP
```

#### 路径 B：直接使用完整域名的请求（不经过 DevServer proxy）

```javascript
// cupid-service.js — axios 实例直接使用完整域名
const service = axios.create({
  baseURL: domain.VUE_APP_51JOB_API.address,   // 'https://cupid.51job.com'
  timeout: domain.VUE_APP_51JOB_API.timeout
})
```

**此路径的完整链路**：
```
service({ url: '/some/api' })
  → 实际 URL: https://cupid.51job.com/some/api
  → 浏览器发起跨域请求
  → 不经过 DevServer proxy（因为不是相对路径，不走 localhost:6600）
  → SwitchyOmega3 查到 cupid.51job.com → 转发到 Whistle
  → Whistle 查 cupid.51job.com 规则 → 转发到后端 IP
```

### 3.3 请求拦截器（添加签名、token）

这是主业务接口共用的拦截器逻辑（`base/utils/api/services/index.js`）：

```javascript
// 请求拦截器（简化核心逻辑）
service.interceptors.request.use(async config => {
  const token = getToken()
  config.headers['accesstoken'] = token

  const timestamp = Math.round(Date.now() / 1000)    // 秒级时间戳
  const pageUrl = getPageUrl()                         // 当前页面 URL
  const fromPageUrl = getFromPageUrl()                 // 来源页面 URL

  // 请求体注入业务参数
  config.data = Object.assign(config.data || {}, {
    timestamp,
    pageUrl,
    fromPageUrl,
    webId: '3',
    userType: getUserinfoItem('isnewuser'),
    property: await getProperty(pageUrl, fromPageUrl)
  })

  // 生成 MD5 签名
  config.data.sign = createApiSign(token, config.data)
  // sign = md5(md5(token + ksort(data) + signKey))

  return config
})
```

签名生成逻辑（`base/utils/api/create-apiSign.js`）：
```javascript
const createApiSign = (Token = '', data = {}, key = uniqueKey) => {
  const dataStr = ksort(data)                         // 参数按 key 升序拼接
  const sign = md5(md5(Token + dataStr + key))        // 双重 MD5
  return sign
}
```

---

## 四、Whistle 代理 — 环境切换的核心

### 4.1 在代理链路中的位置

Whistle 是整个链路的**第二跳**：

```
DevServer (localhost:6600)
  → 路径重写后发出请求到 https://ehirej.51job.com/xxx
  → 操作系统的网络请求
  → Whistle 作为系统代理（127.0.0.1:8899）拦截
  → Whistle 根据 Rules 决定转发到哪个 IP:端口
  → 后端服务器
```

### 4.2 Whistle 的规则匹配原理

Whistle 匹配的是 **HTTP 请求头中的 Host 字段**。DevServer proxy 中 `changeOrigin: true` 确保了 Host 被改为 target 域名，从而使 Whistle 能正确匹配。

```
# Whistle 规则语法：
# pattern   target

# 示例：
ehirej.51job.com  10.10.10.10:8443
# ↑ 匹配 Host=ehirej.51job.com 的请求，转发到 10.10.10.10:8443

# host 模式（一行配置多个域名）：
10.10.10.10:8443 ehirej.51job.com cupid.51job.com open.51job.com
```

### 4.3 环境切换实战

```bash
# 安装 Whistle
npm install -g whistle

# 启动（默认 8899 端口）
w2 start

# 首次使用需安装 HTTPS 根证书
w2 ca
```

**Whistle Rules 配置示例**（在 `http://127.0.0.1:8899` 管理界面）：

```
# ===== 方案一：直接写 IP（适合快速切换）=====

# DEV 环境
ehirej.51job.com    10.10.10.10:8443
cupid.51job.com     10.10.10.10:8443
open.51job.com      10.10.10.10:8443
mehireapi.51job.com 10.10.10.10:8443
mallapi.51job.com   10.10.10.10:8443
m.51job.com         10.10.10.10:8443
vibe.51job.com      10.10.10.10:8443

# QA 环境（注释掉上面）
# ehirej.51job.com    10.20.20.20:8443
# ...

# ===== 方案二：使用 Values 分组（推荐）=====
# 在 Values 标签中创建：
#   {dev-backend}:  10.10.10.10:8443
#   {qa-backend}:   10.20.20.20:8443
#   {prod-backend}: 10.30.30.30:8443
#
# Rules 中使用：
# ehirej.51job.com    {dev-backend}
# cupid.51job.com     {dev-backend}
# ...
```

### 4.4 SwitchyOmega3 配置（与 Whistle 配合）

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

**为什么 localhost 要加入"不代理列表"？**
- `SwitchyOmega3` 将代理配置写入 Chrome 网络栈
- 所有 HTTP 请求先经过 SwitchyOmega3 判断
- 如果 localhost 也在代理列表中 → Whistle 收到 `Host: localhost:6600` 的请求但无匹配规则 → 连接失败
- 所以 localhost 直连 = 只代理外部域名（51job.com 等）

---

## 五、nginx 反向代理层（可选，微前端全链路场景用）

README 中提到的 nginx 配置用于将多个 DevServer 端口统一到一个域名下：

```nginx
# /etc/nginx/conf.d/ehire.micro.conf
upstream ehire_micro_gaea {
  server 127.0.0.1:6600;      # 基座
}
upstream ehire_micro_user {
  server 127.0.0.1:6601;      # user 子应用
}

server {
  listen 80;
  server_name ehire-micro.51job.com;   # 虚构的统一域名

  # 跨域头（微前端必须）
  add_header Access-Control-Allow-Origin *;
  add_header Access-Control-Allow-Methods GET,POST,OPTIONS;

  # HMR WebSocket 代理
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "Upgrade";

  location / {
    proxy_pass http://ehire_micro_gaea;          # 基座
  }
  location /micro-user {
    proxy_pass http://ehire_micro_user/micro-user; # user 子应用
  }
}
```

配合 `SwitchHosts`：
```
127.0.0.1 ehire-micro.51job.com
```

这样浏览器访问 `http://ehire-micro.51job.com` → nginx 反向代理 → 各 DevServer。**如果只开发单个子应用（如 gaea），可以跳过 nginx 这层**，直接用 `localhost:6600` 开发。

---

## 六、babel / eslint / sass / browserslist — 当前项目的配置（最简项目全部省略）

以下配置在当前项目中存在，但与代理链路**无关**。最简新项目可以全部省略——不加 babel 插件 = 无需 babel.config.js；不写 scss = 无需 sass-loader；不加 eslint 插件 = 无需 .eslintrc.js。

### babel.config.js（当前项目有，最简项目不需要）

```javascript
module.exports = {
  exclude: ['node_modules/@babel/**', 'node_modules/core-js/**'],
  presets: [
    '@vue/cli-plugin-babel/preset',
    ['@babel/preset-env', {
      targets: { ie: 11, chrome: 58 },
      corejs: 3,
      useBuiltIns: 'usage'
    }]
  ]
}
```

### .browserslistrc（当前项目有，最简项目不需要）
> 1%
last 2 versions
not ie <= 8
not dead
```

### .npmrc 配置（关键：pnpm hoist）

```
# .npmrc
git-checks=false
hoist=true                   # 提升所有依赖到根 node_modules
shamefully-hoist=true        # 更激进的提升（确保 webpack 等可用）
registry=https://registry.npmmirror.com
```

**为什么需要 hoist**：Vue CLI 4.x 不支持 pnpm 的严格 node_modules 结构。`shamefully-hoist=true` 确保 `webpack`、`webpack-dev-server` 等被提升到根 `node_modules`，`vue-cli-service` 才能正常找到它们。

### .eslintrc.js（根目录）

```javascript
module.exports = {
  root: true,
  env: { node: true },
  plugins: ['jsonc'],
  extends: [
    'plugin:vue/essential',
    '@vue/standard'
  ],
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'vue/no-parsing-error': [2, { 'x-invalid-end-tag': false }]
  }
}
```

---

## 七、依赖精简分析 — 从当前项目到最简项目

当前项目有大量与**代理链路无关**的依赖。下面逐个梳理哪些必须、哪些可砍。

### 7.1 代理链路的硬依赖（缺一不可）

代理链路要跑通，只需要这几个东西在运行时存在：

| 环节 | 需要的包 | 来源 |
|------|---------|------|
| 启动 DevServer | `vue-cli-service serve` | `@vue/cli-service` |
| 解析 `.vue` 文件 | `vue-loader` | `@vue/cli-service` 的依赖（自动安装） |
| 编译 `<template>` | `vue-template-compiler` | 必须显式安装，版本匹配 `vue` |
| DevServer HTTP 服务 | `webpack-dev-server` | `@vue/cli-service` 的依赖（自动安装） |
| proxy 功能 | `http-proxy-middleware` | `webpack-dev-server` 的依赖（自动安装） |
| SPA 路由回退 | `connect-history-api-fallback` | `webpack-dev-server` 的依赖（自动安装） |
| 框架渲染 | `vue` | 显式安装 |
| HTTP 请求 | `axios` | 显式安装 |
| Webpack 打包 | `webpack` | `@vue/cli-service` 的依赖（自动安装） |

### 7.2 当前项目中与代理链路无关的依赖

| 被砍掉的包 | 在当前项目的用途 | 为什么可以砍 |
|-----------|-----------------|-------------|
| `vue-router`、`vuex` | 路由、状态管理 | 最简 demo 只有一个页面，不需要 |
| `qiankun` | 微前端基座/子应用加载 | 单应用 demo 不需要 |
| `@51job/element-ui` | UI 组件库 | 用原生 HTML 按钮即可 |
| `node-sass`、`sass-loader` | SCSS 编译 | 用纯 CSS（`<style>` 不加 `lang="scss"`） |
| `@vue/cli-plugin-eslint`、`eslint` | 代码检查 | 不影响运行 |
| `@vue/cli-plugin-router`、`@vue/cli-plugin-vuex` | 脚手架插件 | 不用 router/vuex 就不需要 |
| `@vue/cli-plugin-babel`、`babel-eslint` | JS 语法降级/检查 | 只跑在现代 Chrome 中，ES6+ 原生支持 |
| `core-js`、`@babel/polyfill` | polyfill | 同上，不需要 polyfill |
| `.browserslistrc` | babel/postcss 的目标浏览器 | 没有 babel，不需要 |
| `babel.config.js` | babel 配置 | 没有 babel 插件，不需要 |
| `@51job/ehire-devtool-webpack-plugin` | 公司内部调试工具 | 新项目没有 |

### 7.3 结论：最简项目仅需 4 个显式依赖

```
代理链路的最小依赖集合：

显式安装（4 个）:
  vue                   ← 框架
  axios                 ← HTTP 客户端
  @vue/cli-service      ← DevServer + proxy（自带 webpack、webpack-dev-server、http-proxy-middleware）
  vue-template-compiler ← 编译 .vue 文件（版本必须与 vue 一致）

自动安装（无需声明，@vue/cli-service 的依赖）:
  webpack 4.47.0
  webpack-dev-server 3.11.3
  http-proxy-middleware 1.3.1
  http-proxy 1.18.1
  connect-history-api-fallback 1.6.0
  vue-loader 15.x
  css-loader、html-webpack-plugin ...
```

---

## 八、最简新项目复现 — 完整文件清单

下面每个文件都经过精简，只保留代理链路跑通所必须的内容。

### 8.1 项目目录结构

```
minimal-proxy-project/
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   └── api/
│   │       └── index.js
│   ├── .env.development
│   ├── .env.production
│   ├── vue.config.js
│   └── package.json
├── mock-server/
│   ├── index.js
│   ├── package.json
│   └── start.sh
└── .npmrc                  # 仅 pnpm 需要
```

### 8.2 各文件内容

#### frontend/package.json

```json
{
  "name": "minimal-proxy-frontend",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "serve": "vue-cli-service serve --mode development",
    "build": "vue-cli-service build"
  },
  "dependencies": {
    "axios": "0.24.0",
    "vue": "2.7.16"
  },
  "devDependencies": {
    "@vue/cli-service": "~4.5.0",
    "vue-template-compiler": "2.7.16"
  }
}
```

> **仅 4 个包**。`vue-cli-service serve` 启动后自动拥有 webpack-dev-server proxy 的全部能力。

#### frontend/vue.config.js

```javascript
module.exports = {
  publicPath: '/',

  devServer: {
    host: 'localhost',
    port: 8080,
    hot: true,
    disableHostCheck: true,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },

    proxy: {
      '/api': {
        target: 'https://your-api.example.com',
        changeOrigin: true,
        pathRewrite: { '^/api': '' }
      }
    }
  }
}
```

> 对比当前项目：去掉了 `overlay`、`hotOnly`、`chainWebpack`、`css`、`parallel`、`lintOnSave`——这些都与代理链路无关。

#### frontend/.env.development

```ini
NODE_ENV = 'development'
VUE_APP_ENV = 'development'
VUE_APP_API_DOMAIN = 'https://your-api.example.com'
```

#### frontend/.env.production

```ini
NODE_ENV = 'production'
VUE_APP_ENV = 'production'
VUE_APP_API_DOMAIN = 'https://your-api.example.com'
```

#### frontend/src/api/index.js

```javascript
import axios from 'axios'

const isDev = process.env.NODE_ENV !== 'production'

const service = axios.create({
  baseURL: isDev ? '' : process.env.VUE_APP_API_DOMAIN,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
})

// 开发环境：统一加 /api 前缀，走 DevServer proxy
service.interceptors.request.use(config => {
  if (isDev) {
    config.url = '/api' + config.url
  }
  return config
})

// 响应拦截
service.interceptors.response.use(
  response => {
    const res = response.data
    if (res.code !== 0) {
      console.error('API Error:', res.message)
      return Promise.reject(new Error(res.message))
    }
    return res
  },
  error => {
    console.error('Network Error:', error)
    return Promise.reject(error)
  }
)

export default service

export function getUserInfo(userId) {
  return service({ method: 'get', url: '/user/info', params: { userId } })
}

export function getOrderList(params) {
  return service({ method: 'post', url: '/order/list', data: params })
}
```

#### frontend/src/main.js

```javascript
import Vue from 'vue'
import App from './App.vue'

Vue.config.productionTip = false

new Vue({
  render: h => h(App)
}).$mount('#app')
```

#### frontend/src/App.vue

```vue
<template>
  <div id="app">
    <h1>Minimal Proxy Demo</h1>
    <div>
      <button @click="fetchUser">获取用户信息</button>
      <button @click="fetchOrders">获取订单列表</button>
    </div>
    <pre>{{ result }}</pre>
    <p>当前环境: {{ result ? result.env : '未请求' }}</p>
  </div>
</template>

<script>
import { getUserInfo, getOrderList } from './api'

export default {
  name: 'App',
  data() {
    return { result: null }
  },
  methods: {
    async fetchUser() {
      this.result = await getUserInfo('123')
    },
    async fetchOrders() {
      this.result = await getOrderList({ page: 1 })
    }
  }
}
</script>

<style>
#app { font-family: Arial, sans-serif; padding: 20px; }
button { margin: 5px; padding: 8px 16px; }
pre { background: #f5f5f5; padding: 10px; margin-top: 10px; }
</style>
```

> 注意：`<style>` 没有 `lang="scss"`，因为不需要 sass-loader。

#### frontend/public/index.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Minimal Proxy Demo</title>
</head>
<body>
  <div id="app"></div>
</body>
</html>
```

#### .npmrc（仅 pnpm 需要）

```
hoist=true
shamefully-hoist=true
```

> 如果用 **npm**，**不需要**这个文件。npm 默认扁平化 node_modules，webpack 自然可用。

#### mock-server/package.json

```json
{
  "name": "minimal-mock-server",
  "private": true,
  "scripts": {
    "start:dev": "PORT=3001 MOCK_ENV=dev node index.js",
    "start:qa": "PORT=3002 MOCK_ENV=qa node index.js",
    "start:prod": "PORT=3003 MOCK_ENV=prod node index.js",
    "start:all": "bash start.sh"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}
```

#### mock-server/index.js

```javascript
const express = require('express')
const app = express()
const PORT = process.env.PORT || 3000
const ENV = process.env.MOCK_ENV || 'dev'

app.use(express.json())

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

app.get('/user/info', (req, res) => {
  res.json({
    code: 0,
    message: 'success',
    env: ENV,
    data: { id: req.query.userId, name: `User-${ENV}`, env: ENV }
  })
})

app.post('/order/list', (req, res) => {
  res.json({
    code: 0,
    message: 'success',
    env: ENV,
    data: {
      orders: [
        { id: 1, name: `Order-${ENV}-1`, status: 'pending' },
        { id: 2, name: `Order-${ENV}-2`, status: 'done' }
      ]
    }
  })
})

app.get('/env', (req, res) => {
  res.json({ env: ENV, port: PORT, timestamp: Date.now() })
})

app.listen(PORT, () => {
  console.log(`Mock Server [${ENV}] running on http://localhost:${PORT}`)
})
```

#### mock-server/start.sh

```bash
#!/bin/bash
PORT=3001 MOCK_ENV=dev  node index.js &
PORT=3002 MOCK_ENV=qa   node index.js &
PORT=3003 MOCK_ENV=prod node index.js &
echo "DEV  → http://localhost:3001"
echo "QA   → http://localhost:3002"
echo "PROD → http://localhost:3003"
```

---

## 九、Whistle 配置（新项目版）

### 8.1 安装 & 启动

```bash
npm install -g whistle
w2 start
# 访问管理界面: http://127.0.0.1:8899
# 首次使用安装 HTTPS 证书: w2 ca
```

### 8.2 Whistle Rules 配置

```
# 在 http://127.0.0.1:8899 的 Rules 页签中：

# === DEV 环境（默认启用）===
your-api.example.com    127.0.0.1:3001
open-api.example.com    127.0.0.1:3001

# === QA 环境（切换时取消注释，注释掉上面）===
# your-api.example.com    127.0.0.1:3002
# open-api.example.com    127.0.0.1:3002

# === PROD 环境 ===
# your-api.example.com    127.0.0.1:3003
# open-api.example.com    127.0.0.1:3003
```

### 8.3 使用 Whistle Values 分组（更优雅的环境切换）

在 Values 页签创建：

```
# 名称: dev
127.0.0.1:3001

# 名称: qa
127.0.0.1:3002

# 名称: prod
127.0.0.1:3003
```

在 Rules 中使用：

```
your-api.example.com    {dev}
open-api.example.com    {dev}
# 切换环境时把 {dev} 改成 {qa} 或 {prod}，保存即生效
```

### 8.4 SwitchyOmega3 配置

1. Chrome 安装 SwitchyOmega3 扩展
2. 新建情景模式 → 代理服务器
3. 配置：HTTP `127.0.0.1:8899`
4. 不代理地址列表：`localhost`, `127.0.0.1`, `192.168.*`
5. 浏览器选择该情景模式

---

## 十、完整请求链路验证

启动所有服务后，浏览器打开 `http://localhost:8080`，点击"获取用户信息"：

```
① 浏览器地址栏: http://localhost:8080
   → SwitchyOmega3: localhost → 直连 ✓

② 页面 JS 发起: GET /api/user/info?userId=123
   → 浏览器解析为: http://localhost:8080/api/user/info?userId=123

③ DevServer proxy 匹配 '/api' 规则:
   → pathRewrite: /api 去掉 → /user/info?userId=123
   → changeOrigin: Host 改为 your-api.example.com
   → target: https://your-api.example.com
   → 发起 GET https://your-api.example.com/user/info?userId=123

④ SwitchyOmega3: your-api.example.com 不在"不代理列表"
   → 转发到系统代理 Whistle (127.0.0.1:8899)

⑤ Whistle 匹配规则: your-api.example.com 127.0.0.1:3001
   → 转发到 localhost:3001

⑥ Mock Server (DEV, port 3001) 返回:
   { "code": 0, "env": "dev", "data": { "name": "User-dev" } }

⑦ 页面显示: 当前环境: dev
```

**切换环境**：
```
修改 Whistle Rules: 127.0.0.1:3001 → 127.0.0.1:3002
   → 保存
   → 刷新页面
   → 显示: 当前环境: qa
```

---

## 十一、快速启动命令

```bash
# === 终端 1: 启动 Whistle ===
w2 start

# === 终端 2: 启动多环境 Mock 服务 ===
cd mock-server && bash start.sh

# === 终端 3: 启动前端 ===
cd frontend && pnpm install && pnpm run serve
```

---

## 附：关键依赖版本锁（照搬用）

**显式安装（package.json 中声明）**：

```json
{
  "dependencies": {
    "axios": "0.24.0",
    "vue": "2.7.16"
  },
  "devDependencies": {
    "@vue/cli-service": "~4.5.0",
    "vue-template-compiler": "2.7.16"
  }
}
```

**自动安装的代理链路依赖（`pnpm install` 后出现在 node_modules）**：

| 包名 | 版本 | 作用 |
|------|------|------|
| `webpack` | 4.47.0 | 打包 |
| `webpack-dev-server` | 3.11.3 | DevServer + HMR |
| `http-proxy-middleware` | 1.3.1 | proxy 配置 → 实际代理 |
| `http-proxy` | 1.18.1 | 底层 HTTP 代理（HTTPS→HTTP 桥接） |
| `connect-history-api-fallback` | 1.6.0 | `historyApiFallback` SPA 路由回退 |
| `dotenv` | 8.6.0 | 加载 `.env` 文件 |
| `dotenv-expand` | 5.1.0 | 展开 `.env` 变量引用 |
| `vue-loader` | 15.x | 编译 `.vue` 单文件组件 |

**仅 pnpm 需要**：`.npmrc` 配置 `hoist=true` + `shamefully-hoist=true`（npm 用户忽略）。

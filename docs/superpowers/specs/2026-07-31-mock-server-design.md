# Mock Server 架构设计文档

> 状态：设计定稿，待实施
> 日期：2026-07-31
> 关联文档：`PROXY-ARCHITECTURE.md`、`mock-guide.md`

---

## 一、背景与目标

### 1.1 现状

团队存在两套体系：

| 体系 | 技术栈 | Mock 方案 | 痛点 |
|------|--------|-----------|------|
| 旧项目 | Vue 2.7 + Webpack 4 + qiankun | Whistle + SwitchyOmega3 代理切换环境 | 无可视化 Mock 管理，接口数据修改靠 Whistle 脚本 |
| 规划中新项目 | Vue 3 + Vite | 无 | 无法复用旧体系 |

### 1.2 核心目标

1. **不动旧项目代码** — 旧项目通过 Whistle 透明接入，零改动
2. **自带可视化 Admin 界面** — 树状编辑 Mock 数据，支持 mockjs 语法
3. **本地运行，Git 共享** — 不部署服务器，Mock 数据即 JSON 文件
4. **平滑迁移 Vue3 + Vite** — Mock Server 独立于构建工具，新项目直连即可
5. **多环境秒切** — DEV/QA/PROD 在 Admin 页面下拉框切换，一秒生效

### 1.3 设计决策回顾

| # | 决策点 | 结论 | 原因 |
|---|--------|------|------|
| 1 | Whistle 是否保留 | **必须保留** | 旧项目 axios 写死外部域名 baseURL，只有系统代理层能拦截 |
| 2 | Mock 核心选型 | **独立 Mock Server（方案 A）** | 自带 Admin UI，框架无关，数据文件 Git 友好 |
| 3 | 微前端支持 | **先单应用，预留扩展点** | 快速落地，目录结构为多应用留接口 |
| 4 | 环境切换机制 | **Admin 页面运行时切换，不依赖 Whistle Rules** | 更快，更直观 |
| 5 | 数据共享方式 | **Git 共享 JSON 文件** | 团队无服务器环境 |

---

## 二、总架构

### 2.1 整体数据流

```
                        旧项目（Vue 2.7 + Webpack 4）
                              │
                    浏览器发起 API 请求
                    目标域名: api.example.com
                              │
                              ▼
                    SwitchyOmega3 分流判断：
                    localhost / 127.0.0.1 → 直连
                    其他域名 → 转发到 Whistle (127.0.0.1:8899)
                              │
                              ▼
            ┌───────────────────────────────────────┐
            │        Whistle (127.0.0.1:8899)        │
            │                                        │
            │  Rules:                                │
            │    api.example.com    localhost:8888   │
            │    api2.example.com   localhost:8888   │
            │    open.example.com   localhost:8888   │
            │                                        │
            │  所有后端域名 → Mock Server             │
            └──────────────────┬────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────────┐
            │          Mock Server (localhost:8888)         │
            │                                              │
            │  ┌──────────────────────────────────────┐   │
            │  │  /__admin    可视化管理界面 (SPA)      │   │
            │  │  · 接口列表（树状）                    │   │
            │  │  · JSON 编辑器（新增/修改/删除字段）   │   │
            │  │  · 环境切换（DEV/QA/PROD）            │   │
            │  │  · 实时请求预览                       │   │
            │  └──────────────────────────────────────┘   │
            │                                              │
            │  ┌──────────────────────────────────────┐   │
            │  │  请求处理管线                          │   │
            │  │  ① 收请求 → ② 查 mocks-data/ 目录     │   │
            │  │  ③ 命中Mock → 返回 Mock 数据           │   │
            │  │  ④ 未命中   → 透传到真实后端（可选）    │   │
            │  └──────────────────────────────────────┘   │
            │                                              │
            │  ┌──────────────────────────────────────┐   │
            │  │  mocks-data/  数据目录 (Git 共享)      │   │
            │  │  · JSON 文件 = 接口返回值              │   │
            │  │  · JS 文件   = 动态 Mock 逻辑          │   │
            │  │  · _env.json = 当前环境配置            │   │
            │  └──────────────────────────────────────┘   │
            └──────────────────────────────────────────────┘
                               ▲
                               │
                    新项目（Vue 3 + Vite）
                    DevServer proxy → localhost:8888
                    直连 Mock Server，不经过 Whistle
```

### 2.2 层次关系

```
Layer 4: 管理界面层    /__admin (HTML/JS SPA，可视化编辑)
Layer 3: Mock 匹配层   路由匹配 → 数据返回 / 透传
Layer 2: 代理层        Whistle（旧项目必经）/ DevServer proxy（新项目可选）
Layer 1: 数据层        mocks-data/ 目录（JSON + JS 文件，Git 共享）
```

---

## 三、Mock Server 详细设计

### 3.1 工程结构

```
mock-server/
├── package.json              # 依赖声明
├── server.js                 # Express 入口（主进程）
├── mock.config.js            # 路由映射 & 全局配置
├── admin/                    # 可视化管理界面 SPA
│   ├── index.html            # 入口页面
│   ├── app.js                # 主逻辑（接口列表、编辑器、预览）
│   ├── editor.js             # JSON 树状编辑器组件
│   └── style.css             # 样式
├── src/
│   ├── router.js             # Mock 路由匹配引擎
│   ├── handler.js            # 请求处理（JSON/JS 分发）
│   ├── proxy.js              # 非 Mock 请求透传逻辑
│   ├── watcher.js            # chokidar 文件热更新
│   └── admin-api.js          # Admin 页面的后端 API（读/写/新增/删除接口）
├── mocks-data/               # Mock 数据文件（Git 共享）
│   ├── _env.json             # 环境配置 {"current":"dev","envs":["dev","qa","prod"]}
│   ├── _state.json           # 跨接口共享状态（有状态 Mock）
│   ├── api/                  # 对应 /api/* 路径
│   │   ├── user_info/
│   │   │   ├── dev.json
│   │   │   ├── qa.json
│   │   │   └── prod.json
│   │   ├── order_list.json       # 不分环境，通用
│   │   └── _all.json             # /api/ 下兜底匹配
│   ├── open-api/             # 对应 /open/api/* 路径（目录名中的 - 转为 /）
│   │   └── resource_query/
│   │       ├── dev.json
│   │       └── prod.json
│   └── _all.json             # 全局兜底
└── mock-utils/               # 共享工具
    ├── constant.js           # 业务常量
    └── services.js           # 通用 Mock 辅助函数
```

### 3.2 路由匹配规则

Mock Server 收到请求后，按以下优先级查找 Mock 文件：

```
请求: POST /api/user_info

查找顺序（高→低）:
  1. mocks-data/api/user_info/{当前环境}.json   ← 按环境优先
  2. mocks-data/api/user_info.json               ← 不分环境的通用文件
  3. mocks-data/api/user_info/{当前环境}.js      ← 动态脚本（按环境）
  4. mocks-data/api/user_info.js                 ← 动态脚本（通用）
  5. mocks-data/api/_all.json                    ← 前缀级兜底
  6. mocks-data/api/_all.js                      ← 前缀级动态兜底
  7. mocks-data/_all.json                        ← 全局兜底
  8. 透传到真实后端（如配置了 proxyMap）或返回 404
```

**路径映射规则：**
- URL 中的 `/` 对应目录层级
- 目录名中的 `-` 对应 URL 中的 `/`（`open-api/` → `/open/api/`）
- 文件名去掉扩展名 = endpoint 名
- 子目录方式（`user_info/dev.json`）表示该接口有多环境数据

### 3.3 JSON Mock 文件规范

```jsonc
// mocks-data/api/user_info/dev.json
{
  "code": "0000",
  "message": "成功",
  "data": {
    "id": "@id",
    "name": "@cname",
    "email": "@email",
    "role|1": ["ADMIN", "USER", "GUEST"],
    "active": "@boolean()",
    "tags|2-4": [
      {
        "label": "@cword(2,6)",
        "value": "@integer(1, 100)"
      }
    ],
    "profile": {
      "avatar": "@image('200x200')",
      "phone": "@string('number', 11)",
      "createTime": "@datetime"
    },
    "stats": {
      "score": "@float(60, 100, 1, 1)",
      "rank": "@integer(1, 1000)"
    }
  }
}
```

**规则：**
- 字段值中可以包含 mockjs 模板语法（`@xxx`、`|N-M` 等）
- Mock Server 在返回前自动调用 `mockjs.mock(template)` 解析
- 纯静态值直接透传
- Admin 编辑器提供 mockjs 语法提示和预览

### 3.4 动态 JS Mock 文件

当需要跨请求状态或复杂逻辑时使用 JS 文件：

```javascript
// mocks-data/api/user_info/dev.js
const Mock = require('mockjs');

module.exports = async function (req, res, state) {
  // req.body    — POST 请求体
  // req.query   — URL 参数
  // req.headers — 请求头
  // state       — 全局状态对象（对应 _state.json）

  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 500));

  // 根据状态决定返回值
  const isVip = state.featureEnabled === true;

  const data = Mock.mock({
    code: '0000',
    message: '成功',
    data: {
      id: req.body.userId || Mock.Random.id(),
      name: Mock.Random.cname(),
      vip: isVip,                        // 使用全局状态
      items: [
        { id: Mock.Random.id(), name: Mock.Random.cword(4, 8) }
      ]
    }
  });

  res.json(data);
};
```

### 3.5 环境切换机制

**`_env.json` 文件：**
```json
{
  "current": "dev",
  "envs": ["dev", "qa", "prod"]
}
```

**切换行为：**
- Admin 页面的环境下拉框读取并修改这个文件
- Mock Server 每次读接口数据时实时读取 `current` 值
- 切换后下一个请求立即生效，无需重启

### 3.6 有状态 Mock

**`_state.json` 文件：**
```json
{
  "featureEnabled": false,
  "settingA": false,
  "settingB": false,
  "settingC": true,
  "records": [],
  "dataCache": []
}
```

**Admin 管理接口：**
- `GET /__admin/api/state` — 读取当前状态
- `POST /__admin/api/state` — 修改状态（Admin 页面可视化编辑）
- 动态 JS Mock 文件通过函数参数 `state` 访问

### 3.7 Admin API（管理界面的后端接口）

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/__admin/api/tree` | 获取 mocks-data/ 完整目录树 |
| `GET` | `/__admin/api/file?path=xxx` | 读取指定文件内容 |
| `POST` | `/__admin/api/file` | 创建/更新 Mock 文件 |
| `DELETE` | `/__admin/api/file?path=xxx` | 删除 Mock 文件 |
| `GET` | `/__admin/api/state` | 读取全局状态 |
| `POST` | `/__admin/api/state` | 修改全局状态 |
| `GET` | `/__admin/api/env` | 读取环境配置 |
| `POST` | `/__admin/api/env` | 切换当前环境 |
| `POST` | `/__admin/api/preview` | 预览请求（传 path + body，返回 Mock 结果） |

---

## 四、Admin 可视化管理界面设计

### 4.1 布局

```
┌──────────────────────────────────────────────────────────────────┐
│  Mock Server Admin               环境: [DEV ▾]  端口: 8888  [💾]│
├────────────────┬─────────────────────────────────────────────────┤
│                │                                                  │
│  接口列表       │  响应数据编辑器                                  │
│                │                                                  │
│  🔍 [搜索...]   │  {                                              │
│                │    "code": "0000"               [✎] [✕]        │
│  ▼ /api        │    "data": {                                     │
│    ├ user      │      "role|1": ["ADMIN","USER"] [✎] [✕]        │
│    │  info  ●  │      "items|2-3": [              [✎] [✕] [✚]   │
│    │  list     │        {                                         │
│    ├ order     │          "id": "@id"            [✎] [✕]         │
│    │  submit   │          "name": "@cname"       [✎] [✕]         │
│    │  query    │        }                                        │
│    └ _all      │      ],                                         │
│  ▼ /open/api   │      "createTime": "@datetime"  [✎] [✕]        │
│    ├ resource ●│    }                                             │
│    │  query    │  }                                              │
│    └ _all      │                                                  │
│                │                                                  │
│  [+ 新增接口]   │  [新增字段] [复制节点] [保存]                     │
│                │                                                  │
├────────────────┴─────────────────────────────────────────────────┤
│  实时预览                                                         │
│  POST /api/user_info                              [发送请求 ▶]   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ { "code": "0000", "data": { "id": "xxx", "name": "张三" } } ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 交互功能

| 功能 | 操作 | 说明 |
|------|------|------|
| 选中接口 | 左侧点击接口名 | 右侧加载对应 JSON 进入编辑模式 |
| 编辑字段值 | 点击 [✎] 或双击值 | 进入文本编辑模式，支持 mockjs 语法 |
| 新增字段 | 点击 [新增字段] | 弹出字段名输入框 → 选择类型 → 添加到当前节点 |
| 删除字段 | 点击 [✕] | 确认后删除该字段 |
| 新增数组元素 | 点击 [✚] | 在数组末尾添加一个新对象 |
| 复制节点 | 点击 [复制节点] | 复制整个子树，粘贴到其他接口 |
| 新增接口 | 点击 [+ 新增接口] | 输入路径 → 选择目录 → 生成初始 JSON 模板 |
| 环境切换 | 顶部下拉框 | 修改 _env.json → 编辑区加载对应环境数据 |
| 实时预览 | 底部面板 | 输入请求体 → 发送 → 查看 Mock 实际返回值 |
| 保存 | 点击 [💾] 或 Ctrl+S | 写回 mocks-data/ 文件 |

### 4.3 mockjs 语法支持

编辑器中输入以下语法时实时高亮并给出提示气泡：

| 语法 | 示例 | 说明 |
|------|------|------|
| `@boolean()` | 随机 true/false | |
| `@integer(min, max)` | `@integer(1, 100)` | 随机整数 |
| `@float(min, max, dmin, dmax)` | `@float(0, 100, 2, 2)` | 随机浮点数 |
| `@string(min, max)` | `@string(5, 10)` | 随机字符串 |
| `@string('number', len)` | `@string('number', 11)` | 随机数字字符串 |
| `@cname` | 随机中文名 | Mock.Random.cname() |
| `@cword(min, max)` | `@cword(2, 6)` | 随机中文字符串 |
| `@id` | 随机身份证号 | |
| `@uuid` | 随机 UUID | |
| `@datetime` | 随机日期时间 | |
| `@image(size)` | `@image('200x200')` | 随机图片 URL |
| `@url` | 随机 URL | |
| `@email` | 随机邮箱 | |
| `field\|N-M` | `items\|2-3` | N~M 个元素 |
| `field\|N` | `items\|5` | 固定 N 个元素 |
| `field\|1` | `role\|1` | 随机选 1 个（枚举） |

---

## 五、Whistle 配置详解

### 5.1 安装与启动

```bash
# 全局安装
npm install -g whistle

# 启动（默认 8899 端口）
w2 start

# 首次使用安装 HTTPS 根证书（HTTP 代理不影响，但有 HTTPS 请求时才需要）
w2 ca

# 管理界面
# 浏览器打开 http://127.0.0.1:8899
```

### 5.2 Whistle Rules 配置

在 `http://127.0.0.1:8899` 的 Rules 页签中配置：

```
# ============================================
# Mock Server 指向（所有后端域名 → Mock Server）
# ============================================

# 方案 A：使用 Values（推荐，方便切换）
# 先在 Values 页签创建 mock-server = localhost:8888
api.example.com     {mock-server}
api2.example.com    {mock-server}
open.example.com    {mock-server}

# ============================================
# 需要部分接口走真实后端的情况：
# 先配 Mock 拦截 → 未命中的走下面规则
# ============================================
# api.example.com     10.10.10.10:8443
# api2.example.com    10.10.10.10:8443
```

> **注意：** 替换 `api.example.com` 为你项目的真实后端域名。域名按实际项目配置，这里用 `example.com` 示意。

### 5.3 SwitchyOmega3 配置

1. Chrome 安装 **SwitchyOmega3** 扩展
2. 新建情景模式 → **代理服务器**
3. 配置：

```
协议: HTTP
服务器: 127.0.0.1
端口: 8899

不代理的地址列表:
  localhost
  127.0.0.1
  192.168.*
  <other-local-dev-domains>
```

**为什么 localhost 不能走代理：**
- 浏览器访问 `localhost:6600` 的 DevServer 页面必须直连
- 如果 localhost 也走 Whistle，Whistle 收到 `Host: localhost:6600` 但无匹配规则 → 连接失败
- 所以 SwitchyOmega3 只代理**外部域名**，localhost 直连

### 5.4 如何绕过 Whistle

如果开发者不需要 Mock（比如直接联调真实后端），三种方式：

| 方式 | 操作 | 粒度 |
|------|------|------|
| SwitchyOmega3 切到 [直接连接] | 浏览器插件点一下 | 全局/单浏览器 |
| 注释 Whistle Rules 中的规则 | 在规则前加 `#` | 按域名 |
| 关闭 Whistle | `w2 stop` | 全局 |

---

## 六、旧项目（Vue2 + Webpack + qiankun 微前端）配置

### 6.1 零改动接入

旧项目的 proxy 配置、axios 实例、域名常量**全部保持不变**。Mock Server 完全在代理层透明接入。

### 6.2 微前端架构概述（典型结构）

旧项目通常采用 qiankun 微前端架构，一个基座应用 + 若干子应用各自独立运行：

```
微前端项目（monorepo）
├── base-app/          # 基座应用（qiankun 主应用）
│   ├── vue.config.js
│   └── src/
├── app-user/          # 子应用：用户模块
│   ├── vue.config.js
│   └── src/
├── app-order/         # 子应用：订单模块
│   ├── vue.config.js
│   └── src/
└── app-config/        # 子应用：配置模块
    ├── vue.config.js
    └── src/
```

### 6.3 各应用 devServer 端口规划

| 应用 | 端口 | role | 说明 |
|------|------|------|------|
| base-app | 6600 | 基座 | qiankun 主应用，加载各子应用 |
| app-user | 6601 | 子应用 | 用户相关功能 |
| app-order | 6602 | 子应用 | 订单相关功能 |
| app-config | 6603 | 子应用 | 配置相关功能 |

### 6.4 基座（主应用）关键配置

```javascript
// base-app/vue.config.js
module.exports = {
  // 基座本地开发 publicPath 为 '/'（浏览器直接访问 localhost:6600）
  publicPath: process.env.NODE_ENV === 'production'
    ? `${process.env.VUE_APP_STATICS_PATH}/micro/base-app/`
    : '/',

  devServer: {
    host: 'localhost',
    port: 6600,
    hot: true,
    disableHostCheck: true,      // qiankun 加载子应用时 Host 头可能不对，必须关闭
    historyApiFallback: true,    // 基座用 SPA 模式，所有路由回退到 index.html
    headers: {
      'Access-Control-Allow-Origin': '*'   // 子应用跨域加载必须
    },

    proxy: {
      '/api': {
        target: 'https://api.example.com',
        changeOrigin: true,
        pathRewrite: { '^/api': '' }
      },
      '/openapi': {
        target: 'https://open.example.com',
        changeOrigin: true,
        pathRewrite: { '^/openapi': '' }
      }
      // ... 其他规则不变
    }
  }
}
```

### 6.5 子应用关键配置

```javascript
// app-user/vue.config.js
module.exports = {
  // 【关键】子应用 publicPath 必须是完整 URL（含 localhost 端口）
  // qiankun 通过 fetch 加载子应用 JS/CSS，需要完整地址
  publicPath: process.env.NODE_ENV === 'production'
    ? `${process.env.VUE_APP_STATICS_PATH}/micro/app-user/`
    : 'http://localhost:6601/',

  devServer: {
    host: 'localhost',
    port: 6601,
    hot: true,
    disableHostCheck: true,      // 必须
    historyApiFallback: {},      // 子应用用空对象 {}（不是 boolean true）
    headers: {
      'Access-Control-Allow-Origin': '*'   // 基座跨域加载本子应用资源必须
    },

    proxy: {
      // 【注意】子应用也可能有自己的 proxy，配置逻辑同基座
      '/api': {
        target: 'https://api.example.com',
        changeOrigin: true,
        pathRewrite: { '^/api': '' }
      }
    }
  }
}
```

**基座与子应用的关键差异：**

| 配置项 | 基座 | 子应用 | 原因 |
|--------|------|--------|------|
| `publicPath`（开发） | `/` | `http://localhost:6601/` | qiankun fetch 子应用必须完整 URL |
| `historyApiFallback` | `true` | `{}` | 子应用避免与基座路由冲突 |
| `headers` | `Access-Control-Allow-Origin: *` | 同 | 双向跨域都需要 |
| `disableHostCheck` | `true` | `true` | qiankun 内部转发可能改 Host 头 |

### 6.6 完整代理链路（微前端场景）

```
① 浏览器访问 http://localhost:6600（基座页面）
   → SwitchyOmega3 判断 localhost → 直连 ✓

② 基座 qiankun 加载子应用
   → fetch('http://localhost:6601/app.js')
   → localhost → 直连 ✓
   → 子应用返回的 JS 带 Access-Control-Allow-Origin: * → 跨域加载成功

③ 页面中的 API 请求（任意子应用发出）
   → axios 请求 /api/user/info
   → DevServer proxy (localhost:6600 或 6601) 重写 URL
   → 目标变为 https://api.example.com/user/info
   → SwitchyOmega3: api.example.com 非 localhost → Whistle
   → Whistle 匹配规则 api.example.com → localhost:8888
   → Mock Server 返回数据
```

**整个链路中 Mock Server 对基座和子应用完全透明**——所有 API 请求最终都汇聚到 Mock Server，不管是哪个子应用发出的。
```

---

## 七、新项目（Vue3 + Vite）配置

### 7.1 Vite devServer proxy（直连 Mock Server）

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true
      },
      '/open/api': {
        target: 'http://localhost:8888',
        changeOrigin: true
      }
    }
  }
})
```

**整个请求链路（新项目）：**
```
Vite DevServer proxy (localhost:3000) → localhost:8888
  → Mock Server 返回数据
```

不经过 Whistle，直连 Mock Server。新项目不需要 SwitchyOmega3。

---

## 八、Mock Server 核心依赖

### 8.1 package.json

```json
{
  "name": "v2mock-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "mockjs": "^1.1.0",
    "chokidar": "^4.0.3",
    "http-proxy-middleware": "^3.0.5"
  }
}
```

### 8.2 依赖作用说明

| 包名 | 版本 | 作用 |
|------|------|------|
| `express` | ^4.21.0 | Web 服务器框架，托管 Admin 页面 + 处理 Mock API |
| `mockjs` | ^1.1.0 | 随机数据生成引擎，解析 `@boolean` `\|2-3` 等语法 |
| `chokidar` | ^4.0.3 | 监听 mocks-data/ 目录变化，Admin 修改后即时生效 |
| `http-proxy-middleware` | ^3.0.5 | 非 Mock 请求透传到真实后端 |

**为什么不用旧项目依赖链：**
- 旧项目依赖 `webpack-dev-server 3.x` 内置的 `http-proxy-middleware 1.x`——那是 DevServer 闭包内的
- Mock Server 是独立进程，不经过 Webpack，用自己的 `http-proxy-middleware 3.x`（最新版，Express 4.x/5.x 兼容）
- 两者互不干扰——它们运行在不同进程里

**Node.js 要求：** >= 18（`node --watch` 需要 18+，chokidar 4.x 也要求 18+）

---

## 九、server.js 核心实现概要

### 9.1 启动流程

```javascript
// server.js 伪代码概要
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const chokidar = require('chokidar');
const Mock = require('mockjs');

const app = express();
const PORT = process.env.PORT || 8888;

// 1. 解析请求体
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 3. Admin 管理界面
app.use('/__admin', express.static('admin'));
app.use('/__admin/api', require('./src/admin-api'));

// 4. Mock 路由匹配
app.use('/', require('./src/router'));

// 5. 文件热更新（chokidar 监听 mocks-data/）
require('./src/watcher')();

// 6. 启动
app.listen(PORT, () => {
  console.log(`Mock Server running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/__admin`);
});
```

### 9.2 路由匹配引擎（src/router.js）

```
算法：
  function resolveMockFile(method, path, env):
    1. normalized = path.replace(/^\//, '')           // /api/user_info → api/user_info
    2. endpoint = basename(normalized)                 // user_info
    3. prefix = dirname(normalized)                    // api

    // 按优先级查找
    candidates = [
      `${prefix}/${endpoint}/${env}.js`,               // 环境级动态脚本
      `${prefix}/${endpoint}/${env}.json`,             // 环境级数据
      `${prefix}/${endpoint}.js`,                      // 通用动态脚本
      `${prefix}/${endpoint}.json`,                    // 通用数据
      `${prefix}/_all.js`,                             // 前缀级兜底
      `${prefix}/_all.json`,
      `_all.js`,                                       // 全局兜底
      `_all.json`,
    ]

    for each candidate in candidates:
      fullPath = mocks-data/candidate
      if exists(fullPath):
        return fullPath

    return null  // 未找到，透传
```

---

## 十、快速启动命令（全链路）

```bash
# === 终端 1: 启动 Whistle ===
w2 start
# 浏览器中 SwitchyOmega3 指向 127.0.0.1:8899

# === 终端 2: 启动 Mock Server ===
cd mock-server
npm install
npm run dev

# === 终端 3: 启动旧项目（按原有方式）===
cd old-project
pnpm run serve
# 打开 http://localhost:6600

# === Admin 管理界面 ===
# 打开 http://localhost:8888/__admin
```

---

## 十一、扩展预留

### 11.1 未来微前端支持

当需要支持多子应用时，Mock Server 无需任何改动。只需在 `mocks-data/` 中按子应用划分目录：

```
mocks-data/
├── app-base/       # 基座各环境数据
├── app-user/       # user 子应用
├── app-order/      # order 子应用
└── ...
```

Whistle 规则中按域名区分指向不同目录（如果子应用有不同的后端域名）。

### 11.2 未来 Vue3 + Vite 迁移

新项目只需在 `vite.config.ts` 中配 proxy 指向 `localhost:8888`，`mocks-data/` 目录原样复制过去即可。零迁移成本。

### 11.3 未来部署为共享服务（如果有需要）

Mock Server 本质是一个 Express 应用，可以直接部署到内网机器上：

```bash
# 部署
git clone <repo>
cd mock-server
npm install
nohup node server.js &

# 团队成员 Whistle 规则指向该机器
# api.example.com  10.x.x.x:8888
```

---

## 十二、与旧方案对比总结

| 维度 | 旧方案（Whistle Rules + 脚本） | 新方案（Mock Server + Admin） |
|------|-------------------------------|------------------------------|
| Mock 编辑方式 | 手写 Whistle 脚本 / 改 JSON 文件 | Admin 页面树状编辑器 |
| 新增接口 | 手动创建文件、写 Whistle 规则 | Admin 里点 [+新增接口] |
| 环境切换 | 改 Whistle Rules，多行注释/取消注释 | 下拉框选一下 |
| 团队成员上手 | 需理解 Whistle 规则语法 | 打开 Admin 页面即可 |
| mockjs 语法 | 需在 Whistle 脚本中 require | Admin 有语法提示和预览 |
| 有状态 Mock | Whistle 全局变量（重启丢） | `_state.json` 持久化 + Admin 可视化编辑 |
| 旧项目改动 | 不需要 | 不需要 |
| 新项目接入 | 必须装 Whistle + SwitchyOmega3 | 只需 vite.config.ts 一行 proxy |
| 数据共享 | 各自本地维护 | Git 提交 JSON 文件，全团队同步 |

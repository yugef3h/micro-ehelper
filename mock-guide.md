# Mock 接口使用指南

## 概述

本项目使用 `@flatjs/mock` 作为本地 Mock 服务框架，在开发阶段拦截和模拟后端 API 请求，实现前后端解耦并行开发。Mock 服务通过 `flatjs-mock.config.ts` 统一配置，Mock 数据定义在 `mocks/` 目录中。

---

# 第一部分：现有体系（`@flatjs/mock`）

## 核心依赖

- **`@flatjs/mock`** — Mock 服务框架，提供 `MockBase` 基类、`@mockable()` / `@alias()` 装饰器、以及基于 mockjs 的数据生成能力
- **`mockjs`** — 随机数据生成库，在 Mock 数据中使用 `@` 语法生成随机值

### 版本信息

| 依赖 | 版本 | 说明 |
|------|------|------|
| `@flatjs/mock` | 2.4.2 | Mock 服务核心框架 |
| `@flatjs/cli` | ^3.0.14 | 构建 CLI（通过 `flat serve` 启动 Mock） |
| `@flatjs/forge` | 2.3.10 | Rollup 打包封装（Mock 文件编译用） |
| `mockjs` | 1.1.0 | 随机数据生成 |
| `@types/mockjs` | ^1.0.10 | mockjs 类型定义 |
| `chokidar` | ^4.0.3 | 文件变化监听 |
| `esbuild` | ^0.25.11 | Mock 文件的 TS→JS 编译 |
| `express` | ^5.1.0 | 底层 Web 服务 |
| `http-proxy-middleware` | ^3.0.5 | 非 Mock 请求代理转发 |
| `path-to-regexp` | ^8.3.0 | `@alias` 装饰器的路径模式匹配 |
| `class-validator` | ^0.14.2 | 请求参数校验（`@alias` 中的 validation） |
| `Node.js` | >= 18 | 运行时要求 |

## 启动 Mock 服务

Mock 服务随 `npx flat serve evolve` 命令自动启动，无需单独执行。配置由 `flatjs-mock.config.ts` 读取，端口为 **8888**。

## 配置文件：`flatjs-mock.config.ts`

### 关键配置项

```ts
const MockConfg = defineConfig({
  projectCwd: process.cwd(),
  apiContext: '/__api',      // Mock API 的基础路径前缀
  hostname: getIpAddress(),  // 本机 IP
  port: 8888,                // 服务端口
  staticMap: { ... },        // 静态资源映射
  proxyMap: { ... },         // 代理转发配置（非 Mock 请求透传）
  mockMap: { ... },          // Mock 路由匹配规则（核心）
});
```

### 配置要点

| 配置项 | 作用 |
|--------|------|
| `apiContext` | 前端通过 `{hostUrl}/__api` 访问 Mock 接口 |
| `proxyMap` | 未命中 Mock 的请求代理到后端（支持按 `env` 参数切换 inte/rc/prod 环境） |
| `mockMap` | 定义 URL 路径到 Mock 文件模块的映射关系 |
| `staticMap` | 静态资源目录映射（`/static` → `static/`） |

## Mock 路由机制（mockMap）

`mockMap` 是 Mock 服务的核心路由配置，将不同的 API 路径前缀映射到对应的 Term 模块：

```ts
mockMap: {
  '/finance/proxy': {
    type: 'FUNC_SIMPLE',      // 路由匹配类型
    defs: ['HomePageTerm', 'CouponTerm', ...],  // 要加载的模块
  },
  '/proxy': {
    type: 'FUNC_SIMPLE',
    defs: ['LoanTerm', 'CommonTerm', ...],      // 最常用的模块列表
  },
  '/h5/proxy': {
    type: 'FUNC_SIMPLE',
    defs: ['h5AgreementTerm', 'h5MortgageTerm'],
  },
  '/*': {
    type: 'REST',             // 兜底通配匹配
    defs: ['CommonTerm', 'MktTerm'],
  },
}
```

### 路由匹配类型

| 类型 | 说明 |
|------|------|
| `FUNC_SIMPLE` | 简单函数匹配：请求路径的前缀命中 `key` 后，在其对应的 `defs` 模块中查找匹配的 mock 方法 |
| `REST` | 通配匹配：作为兜底，任意未匹配的路径都会尝试在 `defs` 模块中寻找对应 mock |

### 匹配流程

1. 请求到达 Mock 服务（如 `/__api/proxy`，请求体携带 `functionCode: "tc_loan_apply"`）
2. 请求中间件从 body 中提取 `functionCode`，存入请求头 `flat-mock-fn-name`
3. 根据 URL 路径前缀匹配 `mockMap` 中的 key（`/proxy` 命中 `/proxy`）
4. 在对应 `defs` 列表的模块中查找注册了 `@alias('tc_loan_apply')` 的方法
5. 找到则返回 Mock 数据，未找到则通过 `proxyMap` 代理转发到真实后端

**functionCode 的前缀规则：** 前端 `BizHttpRequest.$getApiPrefix()` 根据 functionCode 自动决定路径前缀：

| functionCode 格式 | 路径前缀 | 示例 |
|---|---|---|
| `fn_*` 开头 | `/finance/proxy/` | `fn_query_tcloan_card_module` → `/finance/proxy/` |
| 其他（`tc_*`、`auth_*` 等） | `proxy/` | `tc_loan_apply` → `proxy/` |

这解释了为什么 `mockMap` 中 `/finance/proxy` 和 `/proxy` 的 defs 列表不同——它们处理不同前缀的接口。

## 实现原理深度分析

### 整体启动流程

`@flatjs/mock` 不是一个简单的静态文件服务器，而是一个**完整的编译-加载-匹配-返回管线**。

```
npx flat serve evolve
  → @flatjs/cli 启动 Rspack devServer
  → 同时调用 @flatjs/mock 的 startMock()
    ├── 1. 创建 Express 实例
    ├── 2. loadMockConfig() 加载 flatjs-mock.config.ts
    │     ├── @hyperse/config-loader 读取配置文件
    │     └── mergeOptions() 与 defaultMockOptions 合并
    ├── 3. attachMockMiddlewares() 挂载中间件
    │     ├── cors()
    │     ├── 静态资源映射 (staticMap)
    │     ├── 代理转发中间件 (proxyMap)
    │     ├── bodyParser (urlencoded + json)
    │     ├── mockMap 路由注册（按路径前缀排序）
    │     └── 兜底错误处理
    ├── 4. prepareMockDomain() 确定 hostUri + port
    ├── 5. createMockWatcher() 启动文件编译管道
    │     ├── fileWalk() 扫描 mocks/ 目录
    │     ├── 按 Term 模块分组 (chunkSize=30)
    │     ├── Rollup + esbuild 编译 TS → ESM .mjs
    │     ├── 动态 import() 加载编译产物
    │     └── FileWatcher (chokidar) 监听文件变化
    └── 6. Express listen → Mock 服务就绪
```

**关键：Mock 服务与 devServer 是两个独立进程**。Mock 运行在独立的 Express 实例上（端口 8888），前端 devServer 将 API 请求代理到它。两者由 `@flatjs/cli` 统一编排。

### Mock 文件编译管道详解

Mock 文件（TypeScript）不能直接 `require()`，`@flatjs/mock` 实现了一套即时编译加动态加载的管道：

```
mocks/HomePageTerm/fn_query_tcloan_card_module.ts
  │
  ▼ [文件发现]
fileWalk("HomePageTerm/**/*.{js,ts}")
  │
  ▼ [分组打包]
mockChunks.spanMockFilesToChunks(files, chunkSize=30)
  同一 Term 模块的文件被分到同一个 chunk
  每个 chunk 分配一个 MD5 hash 作为 watcherId
  │
  ▼ [Rollup 编译]
createRollupWatcher() → @flatjs/forge（封装 Rollup）
  input: chunk 内所有 TS 文件
  plugins: [esbuildTransform(tsconfig), mockResolveExportsActions]
  output: .cache/<watcherId>/<name>.[hash:16].mjs
  │
  ▼ [动态导入]
actionCacheManager.staleMockFile(watcherId, filePath, outputPath)
  → flush(): const module = await import(`${outputPath}.mjs`)
  │
  ▼ [导出归一化]
normalizeMockExports(module)
  → 检查 isConstructor() — 类是否有 mockable 属性
  → 实例化类: new ModuleClass()
  → 收集所有方法到数组中
  │
  ▼ [缓存]
actionCacheManager.exportedServicesOfWatchers.set(watcherId, services)
```

**热更新流程：**

```
文件修改 (chokidar 'change' 事件)
  → FileWatcher.invalidate(filePath)
  → WatcherManager.onWatchFileChanged()
  → 清理旧缓存
  → Rollup 重新编译该 chunk
  → mockResolveExportsActions 插件
    → generateBundle: 标记 stale
    → writeBundle: actionCacheManager.flush(watcherId) 重新加载
```

### 请求匹配详解

#### FUNC_SIMPLE 模式（本项目主要使用）

这是项目中最常用的模式，匹配 `/proxy/`、`/finance/proxy/`、`/h5/proxy/` 下的请求。

**Step 1: 请求到达 — 提取 functionCode**

```ts
// simpleFunctionCodeMiddleware.forFuncSimpleApiRequest
// 从请求体中提取 functionCode
const s = req.body;
const n = _.get(s, 'protocol', s);
const t = _.get(n, 'param', s);
const p = _.get(n, 'functionCode', 'notfound');

// 设置到请求头中，供后续匹配使用
req.headers['flat-mock-fn-name'] = p;      // 如: 'tc_loan_apply'
req.headers['flat-mock-fn-type'] = 'FUNC_SIMPLE';
```

前端发送的请求体结构（由 `BizHttpRequest.$bizPost` 封装）：

```json
{
  "functionCode": "tc_loan_apply",
  "protocol": { "functionCode": "tc_loan_apply", "param": {} },
  "param": {
    "gateId": "duxiaoman"
  }
}
```

**Step 2: 路由到匹配的 middleware**

```
请求 URL: /__api/proxy
  → baseUrl 去掉 apiContext 前缀 → /proxy
  → requestedMockMapItem('/proxy', mockMap)
    → 按 key 长度降序匹配 ('/finance/proxy' > '/proxy' > '/*')
    → 命中 mockMap['/proxy'] → { type: 'FUNC_SIMPLE', defs: [...] }
```

**Step 3: 在所有 defs 中查找**

```ts
// queryMockExports(mockMapItem, functionCode, options)
// 逐个 def 目录查找:
//   1. 读取该目录下的编译后 exports（从 actionCacheManager 获取）
//   2. 在 exports 中查找匹配的 handler
//      → queryActionFromDefExports(functionCode, exports, verbose)

// queryActionFromDefExports 内部:
//   1. 精确匹配: exports[functionCode] 是否为函数
//   2. path-to-regexp 模式匹配: 遍历类方法上的 @alias 路径
//      match('/foo/:id')('/tc_loan_apply') → false
//      match('/tc_loan_apply')('/tc_loan_apply') → true
```

**Step 4: 执行 handler，返回数据**

```ts
const { name, handler } = queryActionFromDefExports('tc_loan_apply', exports);
logger.info(`Action: "/proxy/tc_loan_apply"`);
handler(req, res, next);  // 执行 mock 方法，res.json(mockData)
```

#### REST 模式

用于 `/*` 兜底匹配，直接把请求路径作为匹配 key：

```ts
// standardRestApiMiddleware.forRestApiRequest
req.headers['flat-mock-fn-name'] = req.path;  // 如 '/some/arbitrary/path'
req.headers['flat-mock-fn-type'] = 'REST';
```

### MockBase 源码级实现

`MockBase` 是每个 Mock 类的基类，提供了数据生成、延迟、缓存等核心能力：

```ts
export class MockBase {
  constructor(options = { strategy: 'Memory' }) {
    this.options = options;
  }

  // $cache: 根据 strategy 返回 Memory 或 FileSystem 缓存实例
  //   Memory   → new DataCacheInMemoryStrategy(10000)
  //   FileSystem → new DataCacheInFileSystemStrategy('./.cache/.db/', '.json')
  get $cache() { ... }

  // $mock: 就是 mockjs.mock 函数的引用
  get $mock() { return mockjs.mock; }

  // $mockjs: mockjs 模块本身（可访问 mockjs.Random 等）
  get $mockjs() { return mockjs; }

  // $lodash: lodash 工具库
  get $lodash() { return lodash; }

  // $sleep(ms): 返回一个 resolve 的 Promise
  async $sleep(ms = 1000) {
    return await new Promise(resolve => setTimeout(resolve, ms));
  }

  // $hostUri(req): 获取当前服务的完整 URL
  $hostUri(req) { return req.app.get('hostUri'); }
}
```

### @mockable 和 @alias 装饰器原理

```ts
// @mockable(): 在类上标记 mockable = true
// normalizeMockExports() 用它来判断是否应该实例化
export const mockable = () => function (target) {
  Object.defineProperty(target, 'mockable', { value: true, writable: false });
};

// @alias(path): 将方法注册到类原型上，并将 path 存为 metadata key
export const alias = (path) => function (target, propertyKey, descriptor) {
  const aliasPath = path || propertyKey;
  const originalMethod = descriptor.value;
  const metadataKey = getMetadataKey(propertyKey);  // 如 'flatjs:mock:tcLoanApplyMock'

  descriptor.value = async function (...args) {
    const [req, res, next] = args;
    // 1. 参数校验（class-validator）
    try {
      await validatePayload(target, metadataKey, args, req);
    } catch (err) {
      return res.status(400).json({ code: 'payload.validation.error', ... });
    }
    // 2. 执行原始方法
    try {
      return await originalMethod.call(this, req, res, next);
    } catch (err) { next(err); }
  };

  // 同时以 aliasPath 为 key 注册到目标对象
  if (aliasPath !== propertyKey) {
    target[aliasPath] = descriptor.value;
  }
};
```

### 请求-方法 匹配的核心算法

`queryActionFromDefExports` 的完整逻辑：

```ts
function queryActionFromDefExports(functionCode, exports, verbose = false) {
  // 1. 归一化 functionCode: '/tc_loan_apply' 或 'tc_loan_apply'
  const names = normalizeActionName(functionCode);
  //  → ['/tc_loan_apply', 'tc_loan_apply']

  // 2. 精确匹配：直接查 exports 对象上的属性
  const exact = queryExactHandlerFromExports(exports, names);
  // exports['tc_loan_apply'] 是否为 function? → 是，返回

  // 3. path-to-regexp 模式匹配：遍历原型上的 @alias 路径
  const pattern = queryPathRegExpHandlerFromExports(exports, names, verbose);
  // 原型方法列表（按路径长度降序）:
  //   exports.constructor.prototype → Object.getOwnPropertyNames
  //   对每个方法名，用 match(pattern)(functionCode) 测试
  //   match('/tc_loan_apply')('/tc_loan_apply') → true → 返回该方法
}
```

### defaultMockOptions 默认值

框架在加载配置文件前会设置以下默认值，然后与用户配置深度合并：

```ts
const defaultMockOptions = {
  projectCwd: process.cwd(),
  mockBaseDir: './mocks',        // Mock 文件根目录
  apiContext: '/api',            // API 基础路径（本项目覆盖为 /__api）
  hostname: 'dev.flatjs.com',
  externals: [                   // 编译时不打包的模块
    '@flatjs/mock', '@flatjs/common',
    'mockjs', 'lodash',
    'class-validator', 'class-transformer',
  ],
  port: 4000,                    // 默认端口（本项目覆盖为 8888）
  chunkSize: 100,
  staticMap: { '/static': 'static' },
  mockMap: {
    '/*': { type: 'REST', defs: [], middlewares: { req: [], res: [] } },
  },
};
```

### 前端请求链路

从前端发起 API 调用到 Mock 返回的完整路径：

```
1. 组件调用 service
   LoanTerm.tc_loan_apply({ gateId: 'duxiaoman' })
     → createService() 生成的 Proxy 拦截
     → getServiceHandle() 获取请求实例

2. BizHttpRequest.$bizPost
   → $getApiPrefix('tc_loan_apply')          → 'proxy/' (不带 fn_ 前缀)
   → URL: /proxy/tc_loan_apply

3. 请求体结构（自动封装）
   {
     functionCode: 'tc_loan_apply',
     protocol: { functionCode: 'tc_loan_apply', param: {} },
     param: { gateId: 'duxiaoman' }
   }

4. 经过本地 devServer proxy 转发
   /proxy/* → http://10.x.x.x:8888/__api/proxy/*

5. 到达 @flatjs/mock Express 服务
   → path: /__api/proxy/tc_loan_apply

6. simpleFunctionCodeMiddleware
   → 提取 functionCode: 'tc_loan_apply'
   → 设置 header: flat-mock-fn-name = 'tc_loan_apply'

7. createMockMiddleware
   → 去掉 apiContext 前缀 → /proxy/tc_loan_apply
   → requestedMockMapItem('/proxy/tc_loan_apply', mockMap)
   → 在 defs 中查找注册了该 functionCode 的 handler

8. handler(req, res)
   → await this.$sleep(500)
   → res.json(this.$mock({ code: '0000', data: {...} }))

9. 响应返回 → 前端接收到 mock 数据
```

## Mock 文件目录结构

```
mocks/
├── _core/                  # Mock 基类扩展（缓存能力）
│   ├── mock-base.ts        # MockBaseCustom — 带文件系统缓存的 MockBase
│   └── types.ts            # 缓存 key 类型定义
├── global/                 # 全局配置
│   └── index.ts            # 导出全局数据（如 apiBase）
├── mock-cache/             # 运行时缓存管理接口
│   ├── query_cache.ts      # 查询缓存数据的 Mock 接口
│   └── set_cache.ts        # 设置缓存数据的 Mock 接口
├── services/               # 共享的 Mock 服务辅助函数
│   ├── address.ts          # 地址数据生成
│   ├── support-banks.ts    # 支持银行列表
│   ├── tcQueryConfigs.ts   # 配置项数据
│   └── adSlot/             # 广告位数据
├── utils/                  # 工具函数 & 常量
│   ├── constant.ts         # 业务常量（婚姻状态、职业、收入等枚举）
│   ├── get-static.ts       # 静态文件 URL 生成
│   ├── svg-string.ts       # SVG 模板字符串
│   └── index.ts
├── static/                 # 静态资源（图片等）
└── <TermName>/             # Term 模块 — 按业务领域的 Mock 接口集合
    ├── <endpoint_name>.ts  # 单个接口的 Mock 文件
    └── ...
```

### Term 模块列表

每个 Term 模块对应一个业务领域的接口集合：

| 模块 | 业务领域 |
|------|----------|
| `HomePageTerm` | 首页相关接口 |
| `LoanTerm` / `QuickLoanTerm` | 借款相关接口 |
| `RepayTerm` / `RepayQueryTerm` | 还款相关接口 |
| `CreditTerm` / `CreditAuthTerm` | 授信相关接口 |
| `CommonTerm` | 通用接口（登录、登出、埋点、上传等） |
| `MemberTerm` | 用户信息接口 |
| `BankCardTerm` / `BankCardSignTerm` | 银行卡相关接口 |
| `CouponTerm` / `BenefitTerm` | 优惠券/权益接口 |
| `AgreementTerm` / `h5AgreementTerm` | 协议相关接口 |
| `MarketingTerm` / `MktTerm` | 营销活动接口 |
| `SecurityTerm` | 安全（密码）相关 |
| `CombineLoanTerm` | 组合借款接口 |
| `FundTerm` / `AssetTerm` | 资金/资产接口 |
| `MortgageTerm` / `h5MortgageTerm` | 抵押相关接口 |
| ... | ... |

## Mock 文件编写规范

### 基本模式

每个 Mock 文件是一个 TypeScript 文件，使用 `@mockable()` 类装饰器和 `@alias()` 方法装饰器定义 Mock 端点：

```ts
import { MockBase, alias, mockable } from '@flatjs/mock';

/**
 * 接口描述
 * Seapi: x82DG0nY    ← Seapi 文档链接
 */
@mockable()
export class MockAccountService extends MockBase {
  @alias('/tc_loan_apply')    // 匹配的 API 路径（相对于前缀如 /proxy）
  async tcLoanApplyMock(_req, res) {
    await this.$sleep(500);   // 模拟网络延迟（毫秒）
    const mockData = this.$mock({
      code: '0000',
      message: '成功',
      data: {
        loanStatus: '1',
        needSmsConfirm: '@boolean()',
        gateId: 'duxiaoman',
      },
    });
    res.json(mockData);
  }
}
```

### 两种 Mock 类

#### 1. 继承 `MockBase`（无状态 Mock）

```ts
export class MockAccountService extends MockBase { ... }
```

适用于不需要跨请求状态的简单 Mock。

#### 2. 继承 `MockBaseCustom`（有状态 Mock）

```ts
export class MockAccountService extends MockBaseCustom { ... }
```

`MockBaseCustom` 扩展了 `MockBase`，增加了基于文件系统的缓存能力，支持：

- `this.getCacheData(key)` — 读取缓存值
- `this.setCache(data)` — 设置缓存值
- `this.getAllCacheData()` — 获取全部缓存

这在需要跨接口共享状态的场景中非常有用。例如：在"授信"接口 Mock 中设置 `needApplyCredit = true`，首页卡片接口 Mock 中读取该值来决定返回"已授信"还是"未授信"的卡片。

### mockjs 数据语法

`this.$mock()` 支持 mockjs 的数据模板语法：

| 语法 | 说明 | 示例 |
|------|------|------|
| `'@boolean()'` | 随机布尔值 | `needSmsConfirm: '@boolean()'` |
| `'@uuid'` | 随机 UUID | `processingOrderNo: '@uuid'` |
| `'@id'` | 随机 ID | `token: '@id'` |
| `'key\|1': [...]` | 从数组中随机取一个值 | `'cardType\|1': ['ACCT', 'CREDIT']` |
| `'@cword(3,10)'` | 随机中文字符串 | `buttonTagImgUrl: '@cword(3,10)'` |

## 运行时缓存管理

### 缓存类型定义（`_core/types.ts`）

```ts
type TCacheKeyList = {
  name: string;
  mobile: string;
  passwordFlag: boolean;       // 是否设置密码
  hasPwdFlag: boolean;         // 授信时是否设置过支付密码
  needApplyCredit: boolean;    // 是否需要授信
  needSignFlag: boolean;       // 是否需要签约
  repayRecord: TPlainObject[]; // 还款记录
  dataList: TMockPlainObject[];
};
```

### 管理接口

Mock 服务提供了两个特殊的接口来管理缓存：

| 接口 | 功能 | 说明 |
|------|------|------|
| `POST /proxy/query_cache` | 查询全部缓存 | 返回当前所有缓存分组的键值 |
| `POST /proxy/set_cache` | 设置缓存值 | 修改缓存中指定 key 的值 |

这些接口支持在开发阶段通过工具动态调整 Mock 行为（如切换"已授信"/"未授信"状态）。

## 静态资源

Mock 文件可以通过 `getStatic(req, filename)` 生成静态资源的完整 URL：

```ts
import { getStatic } from '../utils';

// 返回 http://{host}/static/mine-info.png
img: getStatic(req, 'mine-info.png')
```

静态资源文件存放在 `mocks/static/` 目录下，通过配置中的 `staticMap` 映射到 `/static` 路径。

## 非 Mock 请求的代理转发

对于没有定义 Mock 的接口，请求会通过 `proxyMap` 转发到真实后端：

```
前端 → mock服务:8888/__api-proxy/xxx
     → 代理到: http://{ip}:6001/xxx
     → 根据 referer 中的 env 参数选择环境:
        - inte → https://webapifintech.qa.ly.com
        - rc   → https://webapifintech.t.ly.com
        - prod → https://webapifintech.ly.com
```

---

# 第二部分：架构迁移方案

## 迁移背景

后期项目将迁移至 Vue3 + Vite。当前 Mock 体系深度绑定 `@flatjs/mock`（依赖 `@flatjs/cli` 运行时），无法直接复用到 Vite 项目。

**核心原则：将 Mock 层从构建工具中完全解耦，做成独立服务。** Webpack 和 Vite 都只负责把请求代理到它，Mock 层本身不关心前端用什么框架。

## 目标架构

```
┌──────────────────────────────────────────────────┐
│  前端项目（框架无关）                                │
│                                                    │
│  Vue2 + webpack  ──代理──┐                         │
│                           │                        │
│  Vue3 + vite     ──代理──┤    ┌──────────────────┐ │
│                           ├───→│  Mock Server      │ │
│  Whistle（可选）   ──代理──┘    │  （独立进程）      │ │
│                                │  port: 8888       │ │
│  Omega3          ──代理──→    │                  │ │
│                                │  mock.config.js   │ │
│                                │  mock-modules/    │ │
│                                └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 能力对标

| 能力 | 现有方案 (`@flatjs/mock`) | 迁移方案 (独立 Mock Server) |
|------|--------------------------|---------------------------|
| 请求拦截路由 | `mockMap` + `@alias` 装饰器 | `mock.config.js` 路由配置 + 文件目录映射 |
| Mock 数据定义 | TS 文件中 `this.$mock({...})` | JS 文件 `module.exports = { handler() {...} }` |
| 随机数据生成 | mockjs `@boolean` `@uuid` 等 | mockjs（保留，相同语法） |
| 网络延迟模拟 | `this.$sleep(500)` | `await sleep(ms)` |
| 有状态 Mock | `MockBaseCustom` 文件系统缓存 | `MockBase.state` 内存对象 |
| 缓存管理接口 | `/proxy/query_cache` `/proxy/set_cache` | 同样接口 |
| 未命中转发 | `proxyMap` 代理到后端 | `http-proxy-middleware` |
| 热更新 | 保存配置触发热重载 | chokidar 监听文件变化 |

### 前端接入方式

webpack 和 vite 通过一致的 devServer proxy 配置指向 Mock Server：

```js
// vue.config.js (webpack) 或 vite.config.js (vite)
// 两者完全一致
module.exports = {
  devServer: {  // vite 用 server:
    proxy: {
      '/proxy': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
      '/finance/proxy': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
};
```

### Mock Server 工程结构

```
mock-server/
├── mock.config.js           # 路由映射配置
├── server.js                 # Mock Server 入口
├── package.json              # 独立依赖（express, mockjs, http-proxy-middleware, chokidar）
├── mock-modules/             # 接口 Mock 定义
│   ├── base.js               # MockBase — 提供 $mock、缓存能力
│   ├── home/
│   │   ├── tc_query_tcloan_card_module.js
│   │   └── fn_query_my_center_page_info.js
│   ├── loan/
│   │   ├── tc_loan_apply.js
│   │   └── tc_loan_confirm.js
│   └── common/
│       ├── auth_login.js
│       └── tc_query_configs.js
└── mock-utils/               # 共享工具 & 常量
    ├── constant.js
    └── services.js
```

### Mock 定义语法迁移

**现有写法（`@flatjs/mock`）：**
```ts
@mockable()
export class MockAccountService extends MockBase {
  @alias('/tc_loan_apply')
  async tcLoanApplyMock(_req, res) {
    await this.$sleep(500);
    const mockData = this.$mock({
      code: '0000',
      data: { loanStatus: '1', needSmsConfirm: '@boolean()' },
    });
    res.json(mockData);
  }
}
```

**迁移后写法（独立 Mock Server）：**
```js
// mock-modules/loan/tc_loan_apply.js
const { MockBase } = require('../base');

module.exports = {
  path: '/tc_loan_apply',      // 对标 @alias

  async handler(req, res) {
    const base = new MockBase();
    await base.sleep(500);     // 对标 $sleep

    res.json(base.mock({       // 对标 $mock（语法不变）
      code: '0000',
      data: {
        loanStatus: '1',
        needSmsConfirm: '@boolean()',
      },
    }));
  },
};
```

---

# 第三部分：Whistle 实时 Mock 方案

## 3.1 方案概述

不做独立 Mock Server，而是 **让 Whistle 直接读取项目中的文件作为 Mock 数据源**。Whistle 通过文件监听实时感知 mock 目录变化，将匹配的请求直接返回本地文件内容。

```
浏览器请求 /proxy/tc_loan_apply
  → Whistle 代理拦截
  → 读取项目目录 mocks-data/proxy/tc_loan_apply.json
  → 返回文件内容作为响应
  → 文件被修改 → 下次请求自动读到新内容（无需重启）
```

**核心能力：**
- **文件即接口**：一个 JSON 文件 = 一个 Mock 接口，目录路径映射 API 路径
- **实时生效**：修改文件内容立刻反映到下一次请求
- **精准拦截 & 全量兜底**：支持单接口精确匹配 + `_all.json` 通配
- **零侵入**：不修改 webpack/vite 配置，Whistle 在代理层完成拦截

## 3.2 Mock 文件目录规范

```
# 放在项目根目录（也可以在项目外部）
mocks-data/
├── _config.json                  # 全局配置（可选）
├── proxy/                        # 匹配 /proxy/* 请求
│   ├── tc_loan_apply.json        # → /proxy/tc_loan_apply
│   ├── tc_loan_confirm.json      # → /proxy/tc_loan_confirm
│   ├── tc_loan_confirm.js        # → /proxy/tc_loan_confirm（动态脚本）
│   ├── _all.json                 # → /proxy/ 下所有未匹配接口的兜底
│   └── _all.js                   # → 动态兜底脚本
├── finance-proxy/                # 匹配 /finance/proxy/* 请求
│   ├── fn_query_tcloan_card_module.json
│   └── _all.json
├── h5-proxy/                     # 匹配 /h5/proxy/* 请求
│   └── _all.json
└── _all.json                     # 全局兜底 — 所有接口
```

### 目录与 API 路径的映射关系

```
mocks-data/
  proxy/tc_loan_apply.json  ←→  POST /proxy/tc_loan_apply
  finance-proxy/card.json   ←→  POST /finance/proxy/card
  h5-proxy/agreement.json   ←→  POST /h5/proxy/agreement
```

**规则：**
- 目录名中的 `-` 会自动转为 `/`（`finance-proxy` → `finance/proxy`）
- 文件名去掉扩展名即为 endpoint
- `_all.json` / `_all.js` 为特殊文件名，表示该级别下的兜底匹配

### 文件类型

| 类型 | 扩展名 | 特点 | 适用场景 |
|------|--------|------|----------|
| **静态 JSON** | `.json` | 直接返回文件内容，每次相同 | 固定数据结构验证、UI 布局调试 |
| **动态脚本** | `.js` | 每次请求执行脚本，可生成随机数据 | 需要 mockjs 随机数据、有状态逻辑 |

## 3.3 静态 JSON Mock（`*.json`）

最简单的形式，直接把一个 API 的响应数据写进 JSON 文件：

```json
// mocks-data/proxy/tc_loan_apply.json
{
  "code": "0000",
  "message": "成功",
  "data": {
    "loanStatus": "1",
    "needSmsConfirm": false,
    "gateId": "duxiaoman"
  }
}
```

修改、保存文件后，Whistle 下次返回新内容，无需刷新规则。

## 3.4 动态 JS Mock（`*.js`）

当需要随机数据或有状态逻辑时使用 JS 文件：

```js
// mocks-data/proxy/tc_loan_apply.js
const Mock = require('mockjs');

// module.exports 可以是对象（Mock 模板）或函数
module.exports = async function (req, res) {
  // req.query  — URL 参数
  // req.body   — POST 请求体
  // req.headers — 请求头

  const data = Mock.mock({
    code: '0000',
    message: '成功',
    data: {
      loanStatus: '1',
      needSmsConfirm: '@boolean()',
      gateId: 'duxiaoman',
      feeAmount: '@float(100, 5000, 2, 2)',
    },
  });

  res.json(data);
};
```

JS 文件每次请求都会重新 `require`（缓存已清理），所以修改立即生效。

## 3.5 全量兜底（`_all.json` / `_all.js`）

当需要拦截某个路径前缀下的**所有请求**时，使用 `_all.json` 或 `_all.js`：

```
# 精准拦截
mocks-data/proxy/tc_loan_apply.json     → 只拦截 /proxy/tc_loan_apply

# 前缀下全量兜底
mocks-data/proxy/_all.json              → 拦截 /proxy/* 下所有未精准匹配的请求

# 全局兜底
mocks-data/_all.json                    → 拦截所有请求
```

### `_all.js` 示例：动态路由

```js
// mocks-data/proxy/_all.js
// 拦截 /proxy/ 下所有未精准匹配的请求
module.exports = async function (req, res) {
  // req.path 包含完整请求路径，可据此做动态逻辑
  console.log(`[Mock] 兜底拦截: ${req.path}`);

  res.json({
    code: '0000',
    message: `Mock fallback for ${req.path}`,
    data: {},
  });
};
```

## 3.6 Whistle 代理规则配置

在 Whistle 规则中配置一条规则，将所有 API 请求指向 Whistle 插件处理：

```
# ====================================
# Mock 数据处理（由 whistle.mock-local 插件接管）
# ====================================

# 将 /proxy /finance/proxy /h5/proxy 全部交给 mock 插件
/proxy/ whistle.mock-local://mockRoot=/path/to/project/mocks-data
/finance/proxy/ whistle.mock-local://mockRoot=/path/to/project/mocks-data
/h5/proxy/ whistle.mock-local://mockRoot=/path/to/project/mocks-data

# 或者更简洁：所有请求都过一遍 mock 插件（由插件内部判断有无 mock 文件）
# * whistle.mock-local://mockRoot=/path/to/project/mocks-data

# ====================================
# 未命中 Mock → 代理到真实后端
# ====================================
# 插件未匹配的请求自动走下面的规则
/finance/proxy/ https://webapifintech.qa.ly.com
/proxy/ https://webapifintech.qa.ly.com
```

**关键设计：插件的降级逻辑**

```
请求 /proxy/tc_loan_apply
  → 插件在 mocks-data/proxy/ 下查找:
      ❶ tc_loan_apply.js      → 找到，动态执行并返回
      ❷ tc_loan_apply.json    → 找到，直接返回
      ❸ _all.js                → 找到，动态执行并返回
      ❹ _all.json              → 找到，直接返回
      ❺ 都没找到 → 放行，交给后面的规则转发到真实后端
```

这样实现：**有 Mock 文件就拦截返回，没有就透传**，不需要每次新增接口去改 Whistle 规则。

## 3.7 Whistle 插件实现

### 安装（whistle >=2.9 内置插件能力）

```bash
# 全局安装 mock 插件
npm install -g whistle.mock-local

# 或者在 Whistle 的 Plugins 面板中安装
```

### 插件核心逻辑

插件启动后自动做三件事：

1. **扫描** `mockRoot` 目录，建立 `请求路径 → 文件` 的映射表
2. **监听** 目录变化（chokidar），实时更新映射表
3. **拦截** 匹配的请求，读取文件、执行 JS 脚本、返回数据

插件规则语法：

```
whistle.mock-local://mockRoot=<绝对路径>[&delay=500]
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `mockRoot` | mock 文件目录的绝对路径，必填 | `mockRoot=/Users/xxx/project/mocks-data` |
| `delay` | 模拟网络延迟（ms），默认 0 | `delay=500` |
| `watch` | 是否启用文件监听，默认 true | `watch=false` |

### 插件优先级机制（文件查找顺序）

```
请求: POST /proxy/tc_loan_apply

查找顺序（高→低优先级）：
  1. mocks-data/proxy/tc_loan_apply.js       ← 动态脚本优先
  2. mocks-data/proxy/tc_loan_apply.json     ← 静态 JSON 次之
  3. mocks-data/proxy/_all.js                ← 前缀级动态兜底
  4. mocks-data/proxy/_all.json              ← 前缀级静态兜底
  5. mocks-data/_all.js                      ← 全局动态兜底
  6. mocks-data/_all.json                    ← 全局静态兜底
  7. 放行，走 Whistle 后续规则 → 转发后端
```

### 自定义实现（如果不使用 npm 包）

如果不想发布 npm 包，也可以在 Whistle 的 resScript 中实现简化版：

```js
// ~/.whistle/scripts/mock-local.js
// Whistle → Rules: */proxy/ resScript://{mock-local}

const fs = require('fs');
const path = require('path');

const MOCK_ROOT = '/path/to/project/mocks-data';

// 请求 → 文件路径 解析
function resolveMockFile(reqPath) {
  // /proxy/tc_loan_apply → proxy/tc_loan_apply
  const relPath = reqPath.replace(/^\//, '');

  const candidates = [
    `${relPath}.js`,       // 精确 JS
    `${relPath}.json`,     // 精确 JSON
    path.join(path.dirname(relPath), '_all.js'),   // 前缀兜底 JS
    path.join(path.dirname(relPath), '_all.json'), // 前缀兜底 JSON
    '_all.js',             // 全局兜底 JS
    '_all.json',           // 全局兜底 JSON
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(MOCK_ROOT, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  return null;
}

module.exports = async (req, res) => {
  const mockFile = resolveMockFile(req.url);
  if (!mockFile) return res.forward();  // 无 Mock → 放行到后端

  if (mockFile.endsWith('.js')) {
    // 清除 require 缓存，确保修改实时生效
    delete require.cache[require.resolve(mockFile)];
    const handler = require(mockFile);

    if (typeof handler === 'function') {
      return handler(req, res);
    }
    // 如果是对象，作为 Mock 模板处理
    const Mock = require('mockjs');
    return res.json(Mock.mock(handler));
  }

  // JSON 文件直接返回
  const data = JSON.parse(fs.readFileSync(mockFile, 'utf-8'));
  res.json(data);
};
```

> **注意：** resScript 方案每次请求都会 `fs.existsSync` 遍历候选文件（6 次磁盘 I/O），适合 mock 文件不多的场景。文件数量多或对性能敏感时，建议使用 Whistle 插件方案（有内存缓存 + chokidar 监听）。

## 3.8 使用场景矩阵

| 场景 | 配置方式 | 示例 |
|------|---------|------|
| 拦截单个接口 | 精准命名文件 | `mocks-data/proxy/tc_loan_apply.json` |
| 拦截某前缀下所有接口 | `_all.json` | `mocks-data/proxy/_all.json` |
| 拦截整个项目所有接口 | 根目录 `_all.json` | `mocks-data/_all.json` |
| 需要随机数据 | JS 文件 + mockjs | `mocks-data/proxy/tc_loan_apply.js` |
| 需要跨请求状态 | JS 文件 + 全局变量 | 见下方有状态 Mock 示例 |
| 同时开发多个界面 | 混合使用精准 + 兜底 | 已有 mock 的用精准文件，其余用 `_all.json` 兜底 |
| 快速切回真实后端 | 注释 Whistle 规则 | 在规则前加 `#` 或禁用插件 |

### 有状态 Mock 示例（JS 文件）

```js
// mocks-data/proxy/_all.js
// 全局状态存储
const state = {
  needApplyCredit: false,
  passwordFlag: false,
};

// 缓存管理接口的手动实现
const CACHE_MAP = {
  '/proxy/query_cache': (req, res) => {
    res.json({ code: '0000', data: state });
  },
  '/proxy/set_cache': (req, res) => {
    Object.assign(state, req.body);
    res.json({ code: '0000', data: state });
  },
};

module.exports = async function (req, res) {
  // 缓存管理接口
  if (CACHE_MAP[req.path]) {
    return CACHE_MAP[req.path](req, res);
  }

  // 其他兜底 Mock
  res.json({
    code: '0000',
    message: `Mock for ${req.path}`,
    data: {},
  });
};
```

## 3.9 三种方案对比

| 维度 | `@flatjs/mock`（当前） | 独立 Mock Server | Whistle 文件监听 |
|------|----------------------|------------------|-----------------|
| 启动方式 | 随 `flat serve` 自动启动 | 单独 `node server.js` | 随 Whistle 自动启动 |
| Mock 定义 | TS + 装饰器 | JS 模块 | JSON 文件 或 JS 脚本 |
| 热更新 | 保存 .config 文件 | 自动（chokidar） | 自动（文件修改即生效） |
| 依赖侵入 | 强依赖 `@flatjs/cli` | 零侵入 | 零侵入（代理层拦截） |
| 框架绑定 | 仅 React (@flatjs) | 任意框架 | 任意框架 |
| 构建工具绑定 | 仅 Rspack (@flatjs) | 任意构建工具 | 任意构建工具 |
| 状态共享 | 文件系统缓存 | 内存对象 | 内存对象（JS 脚本内） |
| mockjs 支持 | 原生 | 原生 | JS 文件内 require |
| 动态逻辑 | TS 方法内 | JS 函数 | JS 函数 |
| 全量拦截 | 不支持（需逐一定义） | 需配置 | `_all.json` 通配 |
| 适用场景 | React + @flatjs 项目 | 需要独立 Mock 能力的项目 | 已有 Whistle + 零侵入要求的项目 |
| 学习成本 | 需理解装饰器 + TS | 通用 JS | 通用（文件即接口，最直观） |

---

# 附录：迁移路径建议

当前项目已使用 Whistle，建议分阶段迁移：

**阶段一（共存）：** Whistle + `@flatjs/mock` 并行。Whistle 规则中先走 `whistle.mock-local://` 插件查找 mock 文件，未命中再走 `@flatjs/mock`。新接口逐步采用 JSON/JS 文件方式。

**阶段二（切换）：** 将现有 TS Mock 数据导出为 JSON/JS 文件，存放至 `mocks-data/` 目录。关闭 `@flatjs/mock` 的 mock 功能，完全由 Whistle 接管。

**阶段三（Vue3 迁移）：** `mocks-data/` 目录整个复制到新项目，Whistle 规则不变。零迁移成本。

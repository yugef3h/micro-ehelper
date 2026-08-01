# v2mock 项目规范 & 排查指南

## 项目概述

Mock Server + Admin UI（可视化编辑）+ Vue Demo（新/旧代理链路演示）。

## 目录

```
mock-server/       # Mock Server (Express + mockjs)
demo-frontend/     # Vue 2.7 Demo (Webpack 4 devServer proxy)
docs/              # 设计文档 & 实施计划
```

## 调试：前端 JS 排查最佳实践

### 规则 1：不依赖网络的初始化放最前面

```js
// ✅ 正确：事件绑定、回调注册、DOM 操作放在 await 之前
async function init() {
  // 同步部分——先执行，不依赖网络
  TreeEditor.init('tree-editor');
  window._onTreeChange = function () { ... };
  bindEventListeners();

  // 异步部分——依赖服务端
  try {
    const data = await fetch('/api/env');
    populateEnvSelector(data);
  } catch (e) {
    // 失败时上面的同步逻辑仍然正常工作
    console.warn('env API 不可用，使用默认环境');
  }
}

// ❌ 错误：把事件绑定放在 await 后面
async function init() {
  try {
    const data = await fetch('/api/env');  // 如果这里抛异常
    window._callback = function () {};      // 这行永远不会执行！
    bindEvents();                            // 这个也不会执行！
  } catch (e) {}
}
```

### 规则 2：跨模块通信用 window 全局而非闭包

闭包回调出问题时看不到调用链。全局函数可以直接在 Console 检查：

```js
// ✅ 可直接在 Console 里调试
window._onTreeChange = function () { syncTreeToSource(); };

// 在 Console 输入：typeof window._onTreeChange  → 立即知道是否存在
// 在 Console 输入：window._onTreeChange()       → 手动触发验证链路
```

### 规则 3：静默失败是所有 bug 之源

每个关键节点必须打印状态，特别是"什么都没发生"的时候：

```js
// ❌ 静默跳过——出了问题完全不知道
if (onChange) onChange(root);

// ✅ 失败时告知原因
if (onChange) {
  console.log('[tree] calling onChange, root keys:', Object.keys(root));
  onChange(root);
} else {
  console.warn('[tree] onChange not set — callback not registered');
}
```

### 规则 4：分步打日志定位异步链路断裂点

```
期望链路：TreeEditor.edit → commit() → onChange() → syncTreeToSource() → saveCurrentFile()

排查方法：每一步在 Console 打标记
  [tree] commit          ← 是否触发了编辑
  [tree] calling onChange ← 回调是否执行
  [sync] tree changed    ← window._onTreeChange 是否被调用
  [sync] syncTreeToSource ← 同步函数是否进入
  [sync] source changed: true/false ← 源码是否实际被修改
```

看断在哪一步，就是哪一步的输入出了问题。

### 规则 5：单元测试纯逻辑，浏览器只测 DOM

```
test-pipes.js     ← node 直接跑，测 _expandPipes / _collapsePipes（纯数据）
health-check.js   ← 浏览器加载时跑，测 DOM 元素是否可见、JS 模块是否加载
```

DOM 相关的只能在浏览器里测，但数据变换逻辑（pipe 展开/折叠、JSON 解析）一定要提出来用 Node 单测。

### 规则 6：页面加载即验——health-check.js

任何页面改动后，打开 Console 第一眼就看这个：

```
✅ #file-tree 可见
✅ #json-editor 可见
✅ #tree-editor 可见
✅ TreeEditor 已加载
✅ TreeEditor 渲染正常 (N 行)
✅ Admin API 连通 (env=dev)
🎉 健康检查全部通过
```

红色 ❌ 项直接指向问题——不用猜是 DOM 没渲染还是 JS 报错还是 API 不通。

## 技术栈

| 组件 | 技术 |
|------|------|
| Mock Server | Express 4.x, mockjs 1.1, chokidar 4.x |
| Admin UI | Vanilla JS (零框架), 暗色主题 CSS |
| Vue Demo | Vue 2.7, @vue/cli-service 4.5, axios 0.24 |
| 代理层 | Whistle 2.x, SwitchyOmega3 (Chrome 扩展) |

## 关键约定

- Admin UI 不引入任何 JS 框架，保持零依赖
- Mock 数据文件使用 JS 格式：`module.exports = { declare: { delay, status, body }, handler(req, res, state, data) {} }`
- pipe 语法（`items|5`）在树编辑器中展开到最小值，改动后自动转显式数组
- mockjs `@函数` 参数中**不能有空格**：`@float(10,5000,2,2)` ✅，`@float(10, 5000, 2, 2)` ❌（会无限递归）
- `npm run dev` 启动新项目直连模式，`npm run dev:whistle` 启动旧项目 Whistle 代理模式

## Import 管道

Chrome 插件"📥 导入到 Mock Server"按钮 → `POST /__admin/api/import`:

```
YApi 接口页 → fetchYapiData() → { path, method, title, res_body }
  → POST localhost:8888/__admin/api/import
  → src/import.js: schemaToBody(JSON Schema) → mockjs 模板
  → 保存 mocks-data/{path}/dev.js + _schema.json
```

`_schema.json` 保存原始 JSON Schema，供后续数组 resize 从 0 恢复时读取类型信息。

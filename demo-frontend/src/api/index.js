import axios from 'axios'

// ============================================================
// proxyMode 由 .env 文件中的 VUE_APP_PROXY_MODE 决定
//   ".env.direct"   → direct   (新项目直连)
//   ".env.whistle"  → whistle  (旧项目 Whistle 代理链)
// ============================================================
const proxyMode = process.env.VUE_APP_PROXY_MODE || 'direct'
const isDev = process.env.NODE_ENV !== 'production'

// ============================================================
// 模式 A: direct — 新项目直连
//   链: axios(相对路径) → DevServer proxy → Mock Server(:8888)
//   不依赖 Whistle / SwitchyOmega3
// ============================================================
const directService = axios.create({
  baseURL: '',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
})

// 加 /api 前缀，由 DevServer proxy 匹配并转发
directService.interceptors.request.use(config => {
  if (isDev && !config.url.startsWith('/api') && !config.url.startsWith('/__admin')) {
    config.url = '/api' + config.url
  }
  return config
})

// ============================================================
// 模式 B: whistle — 旧项目 Whistle 代理链
//   链: axios(外部域名 https://api.example.com)
//        → 浏览器解析为外部域名
//        → SwitchyOmega3 转发到 Whistle(:8899)
//        → Whistle 规则 api.example.com → localhost:8888
//        → Mock Server(:8888)
//   依赖: w2 start / SwitchyOmega3 / w2 ca
// ============================================================
const whistleService = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
})

// Whistle 模式: 无 DevServer proxy 替我们加 /api 前缀，所以直接拼完整路径
whistleService.interceptors.request.use(config => {
  if (!config.url.startsWith('/api') && !config.url.startsWith('/__admin')) {
    config.url = '/api' + config.url
  }
  return config
})

// ============================================================
// 按模式导出对应实例
// ============================================================
const service = proxyMode === 'whistle' ? whistleService : directService

export default service

// ---- API 方法 (两种模式共用) ----

export function getUserInfo() {
  return service({ method: 'get', url: '/user_info' })
}

export function getOrderList() {
  return service({ method: 'post', url: '/order_list', data: {} })
}

export function getState() {
  return service({ method: 'get', url: '/__admin/api/state' })
}

export function getEnv() {
  return service({ method: 'get', url: '/__admin/api/env' })
}

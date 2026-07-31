import axios from 'axios'

const isDev = process.env.NODE_ENV !== 'production'

const service = axios.create({
  baseURL: isDev ? '' : '/',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
})

// 开发环境：自动加 /api 前缀，走 DevServer proxy → Mock Server
service.interceptors.request.use(config => {
  if (isDev && !config.url.startsWith('/api')) {
    config.url = '/api' + config.url
  }
  return config
})

export default service

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

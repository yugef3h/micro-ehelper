<template>
  <div id="app">
    <header class="topbar">
      <h1>⚡ v2mock Demo — 实时数据面板</h1>
      <div class="meta">
        <span>Mock: <strong :class="serverOk ? 'ok' : 'err'">{{ serverOk ? '已连接' : '未连接' }}</strong></span>
        <span>模式: <strong>{{ proxyMode === 'whistle' ? 'Whistle 代理链' : '直连' }}</strong></span>
        <span>{{ clock }}</span>
      </div>
    </header>

    <div class="container">
      <div class="refresh-bar">
        <label><input type="checkbox" v-model="autoRefresh"> 自动刷新</label>
        <select v-model="intervalSec">
          <option :value="3">3 秒</option>
          <option :value="5">5 秒</option>
          <option :value="10">10 秒</option>
        </select>
        <span class="countdown">下次刷新: {{ countdown }}s</span>
        <button @click="refreshAll">🔄 立即刷新</button>
      </div>

      <!-- 状态 -->
      <div class="card">
        <h3>📊 全局状态 (_state.json)</h3>
        <div class="state-grid">
          <div class="state-item" v-for="(v, k) in stateData" :key="k">
            <div class="key">{{ k }}</div>
            <div class="val" :class="{ true: v === true, false: v === false }">
              {{ fmtVal(v) }}
            </div>
          </div>
        </div>
      </div>

      <!-- JSON Mock -->
      <div class="card">
        <h3>📄 JSON Mock <span class="badge ok" v-if="latency1">{{ latency1 }}ms</span></h3>
        <div class="url"><span class="method get">GET</span>/api/user_info</div>
        <pre class="json-view">{{ result1 }}</pre>
      </div>

      <!-- JS Mock -->
      <div class="card">
        <h3>📜 JS 动态 Mock <span class="badge ok" v-if="latency2">{{ latency2 }}ms</span></h3>
        <div class="url"><span class="method post">POST</span>/api/order_list</div>
        <pre class="json-view">{{ result2 }}</pre>
      </div>

      <!-- 兜底 -->
      <div class="card">
        <h3>🃏 兜底匹配</h3>
        <div class="url"><span class="method get">GET</span>/api/nonexistent_xxx</div>
        <pre class="json-view">{{ result3 }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
import { getUserInfo, getOrderList, getState, getEnv } from './api'

export default {
  name: 'App',
  data() {
    return {
      proxyMode: process.env.VUE_APP_PROXY_MODE || 'direct',
      envName: '-',
      serverOk: false,
      clock: '',
      autoRefresh: true,
      intervalSec: 5,
      countdown: 5,
      stateData: {},
      result1: '加载中...',
      result2: '加载中...',
      result3: '加载中...',
      latency1: null,
      latency2: null,
      _timer: null,
      _countdownTimer: null
    }
  },
  methods: {
    fmtVal(v) {
      if (typeof v === 'boolean') return v
      if (Array.isArray(v)) return v.length + ' 条'
      return JSON.stringify(v)
    },
    async refreshAll() {
      // user_info (JSON mock)
      try {
        const t1 = performance.now()
        const r1 = await getUserInfo()
        this.latency1 = (performance.now() - t1).toFixed(0)
        this.result1 = JSON.stringify(r1.data || r1, null, 2)
        this.serverOk = true
      } catch (e) {
        this.result1 = `请求失败: ${e.message}`
        this.serverOk = false
      }

      // order_list (JS mock)
      try {
        const t2 = performance.now()
        const r2 = await getOrderList()
        this.latency2 = (performance.now() - t2).toFixed(0)
        this.result2 = JSON.stringify(r2.data || r2, null, 2)
      } catch (e) {
        this.result2 = `请求失败: ${e.message}`
      }

      // fallback
      try {
        const r3 = await this.$http.get('/nonexistent_xxx')
        this.result3 = JSON.stringify(r3.data || r3, null, 2)
      } catch (e) {
        this.result3 = `兜底命中: ${e.message}`
      }

      // state
      try {
        const rs = await getState()
        this.stateData = rs.data || {}
      } catch (e) { /* ignore */ }

      // env
      try {
        const re = await getEnv()
        if (re.data) this.envName = re.data.current.toUpperCase()
      } catch (e) { /* ignore */ }

      this.clock = new Date().toLocaleTimeString()
      this.countdown = this.intervalSec
    },
    startTimers() {
      this._countdownTimer = setInterval(() => {
        this.countdown--
        if (this.countdown <= 0) {
          if (this.autoRefresh) this.refreshAll()
          this.countdown = this.intervalSec
        }
      }, 1000)
    }
  },
  created() {
    // axios instance for manual calls (fallback)
    const axios = require('axios')
    this.$http = axios.create({ timeout: 10000 })
    this.$http.interceptors.request.use(c => {
      if (!c.url.startsWith('/api')) c.url = '/api' + c.url
      return c
    })

    this.refreshAll()
    this.startTimers()
  },
  beforeDestroy() {
    clearInterval(this._countdownTimer)
  }
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; color: #333; min-height: 100vh; }
.topbar { background: #1a1a2e; color: #fff; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
.topbar h1 { font-size: 16px; font-weight: 600; }
.topbar .meta { font-size: 12px; color: #89b4fa; }
.topbar .meta span { margin-right: 16px; }
.topbar .meta .ok { color: #a6e3a1; }
.topbar .meta .err { color: #f38ba8; }
.container { max-width: 1000px; margin: 20px auto; padding: 0 16px; }
.card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.card h3 { font-size: 13px; color: #999; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px; }
.card .url { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; color: #666; margin-bottom: 10px; }
.card .url .method { font-weight: bold; margin-right: 6px; }
.card .url .method.get { color: #1565c0; }
.card .url .method.post { color: #2e7d32; }
.json-view { background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 12px; font-family: 'SF Mono', Consolas, monospace; font-size: 12px; line-height: 1.5; max-height: 300px; overflow: auto; white-space: pre-wrap; margin: 0; }
.state-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.state-item { background: #f5f5f5; border-radius: 4px; padding: 10px 12px; }
.state-item .key { font-size: 11px; color: #999; margin-bottom: 4px; }
.state-item .val { font-size: 15px; font-weight: 600; }
.state-item .val.true { color: #2e7d32; }
.state-item .val.false { color: #999; }
.badge { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 3px; margin-left: 6px; }
.badge.ok { background: #e8f5e9; color: #2e7d32; }
.refresh-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 12px; }
.refresh-bar label { color: #666; cursor: pointer; }
.refresh-bar select { padding: 2px 6px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; }
.refresh-bar .countdown { color: #999; font-size: 11px; }
.refresh-bar button { margin-left: auto; padding: 4px 12px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; }
</style>

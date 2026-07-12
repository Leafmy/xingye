<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'

// 版本号从后端 /api/version 获取
const VERSION = ref('...')

// ================= Types =================
interface Metrics {
  uptime: number; memoryMB: number; gcMemoryMB: number
  totalAiRequests: number; totalAiErrors: number; commandsHandled: number
  sessionMessages: number; totalMessages: number; connectedGroups: number
  boundUsers: number; steamSubscribers: number; activeWsConnections: number
  timestamp: string
}
interface LogEntry { timestamp: string; level: string; message: string }
interface TokenStat { date: string; inputTokens: number; outputTokens: number; totalTokens: number; requestCount: number }
interface GroupInfo { id: number; name: string }

// ================= State =================
const activeTab = ref('overview')
const sidebarOpen = ref(true)
const wsConnected = ref(false)
const metrics = ref<Metrics>({
  uptime: 0, memoryMB: 0, gcMemoryMB: 0, totalAiRequests: 0, totalAiErrors: 0,
  commandsHandled: 0, sessionMessages: 0, totalMessages: 0, connectedGroups: 0,
  boundUsers: 0, steamSubscribers: 0, activeWsConnections: 0, timestamp: ''
})
const logs = ref<LogEntry[]>([])
const autoScroll = ref(true)
const logLevelFilter = ref('all')
const logSearch = ref('')
const logLevels = [
  { value: 'all', label: '全部', color: '#8892a8' },
  { value: 'info', label: 'INFO', color: '#38bdf8' },
  { value: 'success', label: 'SUCCESS', color: '#22c55e' },
  { value: 'warn', label: 'WARN', color: '#f59e0b' },
  { value: 'error', label: 'ERROR', color: '#ef4444' },
]
const cliInput = ref('')
const cliResult = ref('')
const cliResultTimer = ref<number | null>(null)
const tokenStats = ref<TokenStat[]>([])
const totalTokens = ref(0)
const groups = ref<GroupInfo[]>([])
const selectedGroupId = ref<number | null>(null)
const messageInput = ref('')
const sendLoading = ref(false)
const sendResult = ref('')
const memoryHistory = ref<number[]>([])
const tokenHistory = ref<number[]>([])
const maxHistoryPoints = 30

const navItems = [
  { key: 'overview', label: '总览', desc: '主机与服务状态', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>' },
  { key: 'usage', label: '用量', desc: 'AI 调用统计', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>' },
  { key: 'settings', label: '功能管理', desc: '功能配置管理', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' },
  { key: 'sysconfig', label: '系统设置', desc: 'Bot 系统配置', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>' },
  { key: 'logs', label: '日志', desc: '实时事件流', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>' },
  { key: 'messaging', label: '消息', desc: '发送群消息', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>' },
  { key: 'cli', label: '终端', desc: 'Web CLI', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>' },
  { key: 'friendmgmt', label: '好友管理', desc: '好友申请与白名单', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
]

// ================= WebSocket =================
let ws: WebSocket | null = null
let reconnectDelay = 1000
function connect() {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${wsProtocol}//${location.host}`)
  ws.onopen = () => {
    wsConnected.value = true; reconnectDelay = 1000
    // 重启完成后自动清除重启状态并刷新数据
    if (sysRestarting.value) {
      sysRestarting.value = false
      sysConfigMsg.value = '重启完成'
      setTimeout(() => { if (sysConfigMsg.value === '重启完成') sysConfigMsg.value = '' }, 2000)
      fetchTokenStats(); fetchGroups(); fetchSysConfig(); fetchFeatures(); fetchSettingsData()
    }
  }
  ws.onclose = () => { wsConnected.value = false; setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 30000) }
  ws.onerror = () => {}
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'history') logs.value = msg.data.slice(-500)
      else if (msg.type === 'metrics') {
        metrics.value = msg.data
      }
      else if (msg.type === 'log') { logs.value.push(msg.data); if (logs.value.length > 500) logs.value.shift() }
      else if (msg.type === 'cli_result') {
        cliResult.value = msg.data.result
        if (cliResultTimer.value) clearTimeout(cliResultTimer.value)
        cliResultTimer.value = window.setTimeout(() => { cliResult.value = '' }, 10000)
      }
    } catch {}
  }
}

function sendCliCommand() {
  if (!cliInput.value.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(cliInput.value); cliInput.value = ''
}

const formattedUptime = computed(() => {
  const h = Math.floor(metrics.value.uptime / 3600)
  const m = Math.floor((metrics.value.uptime % 3600) / 60)
  return `${h}h ${m}m`
})
const uptimeFull = computed(() => {
  const t = metrics.value.uptime
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  return d > 0 ? `${d}天 ${h}时 ${m}分` : `${h}时 ${m}分 ${s}秒`
})

// Nav computed
const currentNavItem = computed(() => navItems.find(n => n.key === activeTab.value) || navItems[0])
const currentNavIcon = computed(() => currentNavItem.value.icon)
const currentNavLabel = computed(() => currentNavItem.value.label)
const currentNavDesc = computed(() => currentNavItem.value.desc)

// Stat cards
const statCards = computed(() => [
  { label: '服务状态', val: wsConnected.value ? '运行中' : '离线', sub: wsConnected.value ? '已连接到后端' : '未连接', color: '#22c55e', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>', iconClass: '', tab: '' },
  { label: '本次消息', val: metrics.value.sessionMessages.toLocaleString(), sub: '历史 ' + metrics.value.totalMessages.toLocaleString(), color: '#a78bfa', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>', iconClass: '', tab: '' },
  { label: 'AI 请求', val: metrics.value.totalAiRequests.toLocaleString(), sub: '错误 ' + metrics.value.totalAiErrors, color: '#a78bfa', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>', iconClass: '', tab: '', isError: metrics.value.totalAiErrors > 0 },
  { label: '已知群组', val: String(metrics.value.connectedGroups), sub: '绑定 ' + metrics.value.boundUsers, color: '#a78bfa', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', iconClass: '', tab: '' },
  { label: '系统运行', val: formattedUptime.value, sub: uptimeFull.value, color: '#a78bfa', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>', iconClass: '', tab: '' },
])

// ================= Date-range padding helper =================
function padDateRange(
  raw: TokenStat[],
  from: Date,
  to: Date
): TokenStat[] {
  const result: TokenStat[] = []
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  while (d <= end) {
    const dateStr = d.toISOString().split('T')[0]
    const found = raw.find(s => s.date === dateStr)
    result.push(found ?? { date: dateStr, inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0 })
    d.setDate(d.getDate() + 1)
  }
  return result
}

// Charts
const charts = computed(() => {
  const memData = memoryHistory.value
  const memMax = Math.max(...memData, 1)
  const now = new Date()
  const memXL = memData.length > 2
    ? [new Date(now.getTime() - (memData.length - 1) * 5000), new Date(now.getTime() - Math.floor(memData.length / 2) * 5000), now].map(t => `${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`)
    : memData.map(() => `${now.getMinutes()}:${now.getSeconds()}`)
  const memYL = [memMax, Math.round(memMax / 2), 0].map(v => v + ' MB')

  // Pad token data from first record to today
  const tokStatsAll = tokenStats.value
  let tokPadded: TokenStat[] = []
  if (tokStatsAll.length > 0) {
    const firstDate = new Date(tokStatsAll[0].date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    tokPadded = padDateRange(tokStatsAll, firstDate, today)
  }
  const tokDataFull = tokPadded.map(s => s.totalTokens)
  const tokXFull = tokPadded.map(s => s.date.slice(5))
  const tokTipsFull = tokPadded.map(s => `${s.date}: ${s.totalTokens.toLocaleString()}`)
  // Reduce X-axis labels to at most 6 evenly-spaced ticks
  function reduceLabels(labels: string[]): string[] {
    if (labels.length <= 6) return labels
    const step = (labels.length - 1) / 5
    return [0, 1, 2, 3, 4, 5].map(i => labels[Math.round(i * step)])
  }
  const tokMax = Math.max(...tokDataFull, 1)
  const tokYL = [tokMax, Math.round(tokMax / 2), 0].map(v => v.toLocaleString())

  return [
    { id: 'mem', title: '内存趋势', val: memData.length ? `当前 ${memData[memData.length - 1]} MB` : '暂无数据', data: memData, yLabels: memYL, xLabels: reduceLabels(memXL), tooltipTitle: '内存', tooltipLabels: memData.map(v => `${v} MB`) },
    { id: 'tok', title: '每日 Token 消耗', val: `总计 ${totalTokens.value.toLocaleString()}`, data: tokDataFull, yLabels: tokYL, xLabels: reduceLabels(tokXFull), tooltipTitle: 'Token', tooltipLabels: tokTipsFull },
  ]
})
// ================= Usage Charts (DeepSeek style) =================
const usageMonth = ref('')
const usageMonthOptions = computed(() => {
  const months = new Set<string>()
  tokenStats.value.forEach(s => months.add(s.date.slice(0, 7)))
  return Array.from(months).sort().reverse()
})
function monthBoundaries(monthStr: string): { start: Date; end: Date } {
  const [y, m] = monthStr.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0, 23, 59, 59) // last day of month
  // Don't pad past today
  const today = new Date()
  return { start, end: end > today ? today : end }
}
const filteredMonthStats = computed(() => {
  const m = usageMonth.value || new Date().toISOString().slice(0, 7)
  const { start, end } = monthBoundaries(m)
  return padDateRange(tokenStats.value, start, end)
})
const usageSpendingData = computed(() => {
  const stats = filteredMonthStats.value
  if (!stats.length) return { dates: [], values: [], yLabels: [], xLabels: [] }
  const dates = stats.map(s => s.date.slice(5))
  const values = stats.map(s => s.totalTokens)
  const max = Math.max(...values, 1)
  const yLabels = [max, Math.round(max / 2), 0].map(v => v.toLocaleString())
  return { dates, values, yLabels, xLabels: reduceLabels(dates), tips: stats.map(s => `${s.date}: ${s.totalTokens.toLocaleString()} tokens`) }
})
const usageRequestData = computed(() => {
  const stats = filteredMonthStats.value
  if (!stats.length) return { dates: [], values: [], yLabels: [], xLabels: [] }
  const dates = stats.map(s => s.date.slice(5))
  const values = stats.map(s => s.requestCount)
  const max = Math.max(...values, 1)
  const yLabels = [max, Math.round(max / 2), 0].map(v => v.toLocaleString())
  return { dates, values, yLabels, xLabels: reduceLabels(dates), tips: stats.map(s => `${s.date}: ${s.requestCount} 次`) }
})
const usageTokenDetailData = computed(() => {
  const stats = filteredMonthStats.value
  if (!stats.length) return { dates: [], input: [], output: [], yLabels: [], xLabels: [] }
  const dates = stats.map(s => s.date.slice(5))
  const input = stats.map(s => s.inputTokens)
  const output = stats.map(s => s.outputTokens)
  const maxVal = Math.max(...input.map((v, i) => v + output[i]), 1)
  const yLabels = [maxVal, Math.round(maxVal / 2), 0].map(v => v.toLocaleString())
  return { dates, input, output, yLabels, xLabels: reduceLabels(dates) }
})
const usageSummary = computed(() => {
  const stats = filteredMonthStats.value
  const actual = stats.filter(s => s.totalTokens > 0 || s.requestCount > 0)
  return {
    totalTokens: stats.reduce((s, v) => s + v.totalTokens, 0),
    totalRequests: stats.reduce((s, v) => s + v.requestCount, 0),
    avgTokensPerReq: stats.reduce((s, v) => s + v.totalTokens, 0) / Math.max(stats.reduce((s, v) => s + v.requestCount, 0), 1),
    days: actual.length
  }
})

// Usage chart tooltip
const usageTip = ref({ show: false, x: 0, y: 0, text: '', chartId: '' })
const usageTipBar = ref(-1)

function onUsageBarMouseMove(e: MouseEvent, data: any, chartId: string) {
  const chartEl = (e.target as HTMLElement).closest('.usage-chart-main')!
  const rect = chartEl.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const relX = mouseX / rect.width
  const svgX = relX * 600
  Math.max(...data.values, 1)
  const barW = Math.max((600 - 2 * (data.values.length + 1)) / data.values.length, 3)
  let idx = -1
  data.values.forEach((_: number, i: number) => {
    const x = 2 + i * (barW + 2)
    if (svgX >= x && svgX <= x + barW) idx = i
  })
  if (idx === -1) { usageTip.value = { show: false, x: 0, y: 0, text: '', chartId: '' }; usageTipBar.value = -1; return }
  usageTipBar.value = idx
  const barX = 2 + idx * (barW + 2) + barW / 2
  const barScreenX = rect.left + (barX / 600) * rect.width
  usageTip.value = { show: true, x: barScreenX, y: rect.top + 8, text: data.tips?.[idx] || '', chartId }
}

function onUsageLineMouseMove(e: MouseEvent, data: any, chartId: string, stacked?: boolean) {
  const chartEl = (e.target as HTMLElement).closest('.usage-chart-main')!
  const rect = chartEl.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const relX = mouseX / rect.width
  const svgX = relX * 600
  const vals = stacked ? data.input.map((v: number, i: number) => v + data.output[i]) : data.values
  Math.max(...vals, 1)
  const p = 4
  let nearestIdx = 0, nearestDist = Infinity
  vals.forEach((_: number, i: number) => {
    const px = data.dates.length > 1 ? (i / (data.dates.length - 1)) * (600 - p * 2) + p : 300
    const dist = Math.abs(svgX - px)
    if (dist < nearestDist) { nearestDist = dist; nearestIdx = i }
  })
  if (nearestDist > 60) { usageTip.value = { show: false, x: 0, y: 0, text: '', chartId: '' }; return }
  const px = data.dates.length > 1 ? (nearestIdx / (data.dates.length - 1)) * (600 - p * 2) + p : 300
  const screenX = rect.left + (px / 600) * rect.width
  let text = ''
  if (stacked) {
    text = `${data.dates[nearestIdx]}: 输入 ${data.input[nearestIdx].toLocaleString()} / 输出 ${data.output[nearestIdx].toLocaleString()}`
  } else {
    text = data.tips?.[nearestIdx] || `${data.dates[nearestIdx]}: ${vals[nearestIdx]}`
  }
  usageTip.value = { show: true, x: screenX, y: rect.top + 8, text, chartId }
}

function onUsageMouseLeave(chartId: string) {
  if (usageTip.value.chartId === chartId) { usageTip.value = { show: false, x: 0, y: 0, text: '', chartId: '' } }
  if (usageTipBar.value >= 0 && usageTip.value.chartId === '') usageTipBar.value = -1
}

const filteredLogs = computed(() => logLevelFilter.value === 'all' ? logs.value : logs.value.filter(l => l.level === logLevelFilter.value))
const filteredSearchLogs = computed(() => {
  let result = filteredLogs.value
  if (logSearch.value.trim()) {
    const q = logSearch.value.toLowerCase()
    result = result.filter(l => l.message.toLowerCase().includes(q) || l.level.toLowerCase().includes(q) || l.timestamp.includes(q))
  }
  return result
})
function clearLogs() { logs.value = [] }
function downloadLogs() {
  const text = filteredSearchLogs.value.map(l => `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`).join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `xingye-logs-${new Date().toISOString().slice(0,10)}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}
function logColor(level: string) { return level === 'error' ? 'var(--destructive)' : level === 'warn' ? 'var(--warning)' : 'var(--primary)' }

async function fetchTokenStats() {
  try {
    const res = await fetch('/api/token-stats')
    const data = await res.json()
    if (data.success) {
      // API returns newest-first; sort ascending so charts iterate oldest→newest
      const sorted = (data.data.daily as TokenStat[]).sort((a, b) => a.date.localeCompare(b.date))
      tokenStats.value = sorted
      totalTokens.value = data.data.totalTokens
      tokenHistory.value = sorted.map((s: TokenStat) => s.totalTokens)
    }
  } catch {}
}
async function fetchGroups() {
  try { const res = await fetch('/api/groups-detail'); const data = await res.json(); if (data.success) groups.value = data.data } catch {}
}
async function refreshGroups() {
  try { await fetch('/api/refresh-groups', { method: 'POST' }); setTimeout(fetchGroups, 2000) } catch {}
}
async function sendMessage() {
  if (!selectedGroupId.value || !messageInput.value.trim() || sendLoading.value) return
  sendLoading.value = true; sendResult.value = ''
  try {
    const res = await fetch('/api/send-message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroupId.value, message: messageInput.value.trim() })
    })
    const data = await res.json()
    if (data.success) { sendResult.value = '消息已发送'; messageInput.value = '' } else sendResult.value = data.error
  } catch { sendResult.value = '网络错误' }
  finally { sendLoading.value = false; setTimeout(() => { sendResult.value = '' }, 3000) }
}

// ================= Settings State =================
interface BindingEntry { userId: number; accounts: any[] }
interface SubscriptionEntry { userId: number; subscriptions: any[] }
interface GroupEntry { id: number; name: string }

const allBindings = ref<BindingEntry[]>([])
const allSubscriptions = ref<SubscriptionEntry[]>([])
const allGroups = ref<GroupEntry[]>([])
const settingsLoading = ref(false)
const settingsMsg = ref('')

async function fetchSettingsData() {
  settingsLoading.value = true
  try {
    const [b, s, g] = await Promise.all([
      fetch('/api/bindings').then(r => r.json()),
      fetch('/api/subscriptions').then(r => r.json()),
      fetch('/api/all-groups').then(r => r.json()),
    ])
    if (b.success) allBindings.value = b.data
    if (s.success) allSubscriptions.value = s.data
    if (g.success) allGroups.value = g.data
  } catch {}
  settingsLoading.value = false
}

async function doUnbind(userId: number, platform: string, accountId: string) {
  try {
    const r = await fetch('/api/unbind', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, platform, accountId })
    })
    const d = await r.json()
    if (d.success) { settingsMsg.value = '已解绑'; await fetchSettingsData(); setTimeout(() => settingsMsg.value = '', 2000) }
    else settingsMsg.value = d.error
  } catch { settingsMsg.value = '网络错误' }
  setTimeout(() => settingsMsg.value = '', 2000)
}

async function doUnsubscribe(userId: number, type: string, appId?: number) {
  try {
    const r = await fetch('/api/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type, appId })
    })
    const d = await r.json()
    if (d.success) { settingsMsg.value = '已取消订阅'; await fetchSettingsData(); setTimeout(() => settingsMsg.value = '', 2000) }
    else settingsMsg.value = d.error
  } catch { settingsMsg.value = '网络错误' }
  setTimeout(() => settingsMsg.value = '', 2000)
}

// ================= System Config =================
interface SysConfig {
  wakeEnabledGroups: number[]
  broadcastEnabled: boolean
  broadcastAdminOnly: boolean
  broadcastEnabledGroups: number[]
  updateLog: string
  customPrompt: string
}

const sysConfig = ref<SysConfig>({
  wakeEnabledGroups: [],
  broadcastEnabled: false,
  broadcastAdminOnly: true,
  broadcastEnabledGroups: [],
  updateLog: '',
  customPrompt: ''
})
const sysConfigSaving = ref(false)
const sysConfigMsg = ref('')
const sysRestarting = ref(false)
const promptConfirm = ref(false)

// 更新系统
const updateChecking = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const updateInfo = ref<any | null>(null)
const updateError = ref('')
const updateProgress = ref('')
const updateApplying = ref(false)

// ================= 好友管理状态 =================
const whitelist = ref<number[]>([])
const whitelistInput = ref('')
const whitelistMsg = ref('')
const whitelistLoading = ref(false)
interface FriendRequestEntry {
  qq: number; nickname: string; comment: string; flag: string
  status: 'pending' | 'approved' | 'rejected'; time: string; handledAt?: string
}
const friendRequests = ref<FriendRequestEntry[]>([])
const frLoading = ref(false)
const frMsg = ref('')

// ================= Feature Flags State =================
interface FeatureFlagInfo {
  key: string
  label: string
  desc: string
  category: string
}

const FEATURE_LIST: FeatureFlagInfo[] = [
  { key: 'aiChat', label: 'AI对话', desc: 'AI闲聊与问答', category: 'AI' },
  { key: 'aiVision', label: 'AI识图', desc: '发送图片让AI识别', category: 'AI' },
  { key: 'aiDraw', label: 'AI画图', desc: 'AI绘画生成图片', category: 'AI' },
  { key: 'biliVideo', label: 'B站视频嗅探', desc: 'B站链接自动下载高清视频', category: '媒体' },
  { key: 'biliLogin', label: 'B站TV登录', desc: 'B站TV扫码登录（解锁1080P+）', category: '媒体' },
  { key: 'cs2Stats', label: 'CS2战绩查询', desc: '查询5E/Steam官匹战绩', category: '游戏' },
  { key: 'steamPlaytime', label: 'Steam游戏时长', desc: '查询Steam游戏时长与排行', category: '游戏' },
  { key: 'steamSubscribe', label: 'Steam订阅', desc: 'Steam游戏折扣订阅与推送', category: '游戏' },
  { key: 'steamDealReport', label: '促销查询与战报', desc: 'Steam促销查询与5E每日战报', category: '游戏' },
  { key: 'promptControl', label: 'Prompt调节', desc: '临时调整AI角色设定', category: 'AI' },
  { key: 'accountBind', label: '账号绑定', desc: '绑定/解绑游戏账号（5E/Steam）', category: '游戏' },
]

const featureFlags = ref<Record<string, boolean>>({})

async function fetchFeatures() {
  try {
    const r = await fetch('/api/features')
    const d = await r.json()
    if (d.success) featureFlags.value = d.data
  } catch {}
}

async function toggleFeature(key: string, enabled: boolean) {
  featureFlags.value[key] = enabled
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch('/api/features', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: enabled }),
      signal: ctrl.signal
    })
    clearTimeout(timer)
    const d = await r.json()
    if (d.success && d.data) featureFlags.value = d.data
  } catch {}
}

const featureCategories = computed(() => {
  const cats: { name: string; items: FeatureFlagInfo[] }[] = []
  const map = new Map<string, FeatureFlagInfo[]>()
  for (const f of FEATURE_LIST) {
    if (!map.has(f.category)) map.set(f.category, [])
    map.get(f.category)!.push(f)
  }
  map.forEach((items, name) => cats.push({ name, items }))
  return cats
})

async function fetchSysConfig() {
  try {
    const r = await fetch('/api/sysconfig')
    const d = await r.json()
    if (d.success) sysConfig.value = d.data
  } catch {}
}

async function saveSysConfig() {
  sysConfigSaving.value = true
  try {
    const r = await fetch('/api/sysconfig', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sysConfig.value)
    })
    const d = await r.json()
    if (d.success) { sysConfigMsg.value = '已保存'; setTimeout(() => sysConfigMsg.value = '', 2000) }
  } catch { sysConfigMsg.value = '保存失败' }
  sysConfigSaving.value = false
}

async function doBroadcast() {
  try {
    const r = await fetch('/api/broadcast', { method: 'POST' })
    const d = await r.json()
    sysConfigMsg.value = d.message || d.error || '完成'
  } catch { sysConfigMsg.value = '广播失败' }
  setTimeout(() => sysConfigMsg.value = '', 3000)
}

async function doRestart() {
  sysRestarting.value = true
  sysConfigMsg.value = '正在重启后端…'
  // 给 fetch 加超时，避免连接被后端关闭后挂住
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    await fetch('/api/restart', { method: 'POST', signal: ctrl.signal })
    clearTimeout(timer)
  } catch {}
  // 轮询 /api/status 确认后端已恢复上线，替代固定 fallback 和 WS 重连
  let pollTimer: number | null = null
  let pollCount = 0
  const poll = () => {
    pollCount++
    fetch('/api/status', { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => {
        if (d.success && sysRestarting.value) {
          sysRestarting.value = false
          sysConfigMsg.value = '重启完成'
          setTimeout(() => { if (sysConfigMsg.value === '重启完成') sysConfigMsg.value = '' }, 2000)
          fetchTokenStats(); fetchGroups(); fetchSysConfig(); fetchFeatures(); fetchSettingsData()
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        }
      })
      .catch(() => {})
    // 最多轮询 60 次（60s），之后自动放弃
    if (pollCount >= 60 && sysRestarting.value) {
      sysRestarting.value = false
      sysConfigMsg.value = '重启超时，请检查后端状态'
      setTimeout(() => { sysConfigMsg.value = '' }, 4000)
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    }
  }
  pollTimer = window.setInterval(poll, 1000)
}

async function doShutdown() {
  if (!confirm('确认关闭所有服务（SnowLuna + 后端 + 前端）？')) return
  sysConfigMsg.value = '正在关闭…'
  try {
    const r = await fetch('/api/shutdown', { method: 'POST' })
    const d = await r.json()
    sysConfigMsg.value = d.message || '已关闭'
  } catch { sysConfigMsg.value = '关闭指令已发送' }
  setTimeout(() => window.close(), 2000)
}

// 更新系统
async function checkForUpdate() {
  // Electron 环境
  if (window.electronAPI) {
    updateChecking.value = true
    updateError.value = ''
    try {
      const result = await window.electronAPI.checkForUpdate()
      if (result.hasUpdate) {
        updateAvailable.value = true
        updateVersion.value = result.latestVersion
        updateInfo.value = result
      } else {
        updateAvailable.value = false
        updateInfo.value = null
        updateError.value = result.error || '当前已是最新版本'
      }
    } catch (e) {
      updateError.value = '检查更新失败：' + e.message
    } finally {
      updateChecking.value = false
    }
    return
  }
  // Web 环境（非 Electron）- 调用后端 API
  try {
    updateChecking.value = true
    updateError.value = ''
    const res = await fetch('/api/check-update')
    const data = await res.json()
    if (data.hasUpdate) {
      updateAvailable.value = true
      updateVersion.value = data.latestVersion
      updateInfo.value = data
    } else {
      updateAvailable.value = false
      updateInfo.value = null
      updateError.value = '当前已是最新版本'
    }
  } catch (e) {
    updateError.value = '检查更新失败'
  } finally {
    updateChecking.value = false
  }
}

async function applyUpdate() {
  if (!confirm('确定要更新吗？更新过程中服务将短暂中断。')) return

  updateApplying.value = true
  updateProgress.value = '正在停止服务...'

  if (window.electronAPI) {
    window.electronAPI.onUpdateProgress((data) => {
      if (data.stage === 'stopping') updateProgress.value = '正在停止服务...'
      else if (data.stage === 'downloading') updateProgress.value = '正在下载更新包...'
      else if (data.stage === 'applying') updateProgress.value = '正在应用更新...'
      else if (data.stage === 'done') updateProgress.value = '更新完成，正在重启...'
    })

    try {
      await window.electronAPI.applyUpdate(updateInfo.value)
    } catch (e) {
      updateError.value = '更新失败：' + e.message
      updateApplying.value = false
    }
  } else {
    updateProgress.value = 'Web 模式下请手动更新'
    try {
      const response = await fetch('/api/apply-update', { method: 'POST' })
      const result = await response.json()
      if (!result.success) throw new Error(result.error || 'update failed')
      updateProgress.value = 'Update started; services will restart shortly.'
    } catch (e) {
      updateError.value = 'Update failed: ' + e.message
      updateApplying.value = false
    }
  }
}

function toggleWakeGroup(gid: number) {
  const i = sysConfig.value.wakeEnabledGroups.indexOf(gid)
  if (i >= 0) sysConfig.value.wakeEnabledGroups.splice(i, 1)
  else sysConfig.value.wakeEnabledGroups.push(gid)
  saveSysConfig()
}

function toggleBroadcastGroup(gid: number) {
  const i = sysConfig.value.broadcastEnabledGroups.indexOf(gid)
  if (i >= 0) sysConfig.value.broadcastEnabledGroups.splice(i, 1)
  else sysConfig.value.broadcastEnabledGroups.push(gid)
  saveSysConfig()
}

// ================= 好友管理 API =================
async function fetchWhitelist() {
  try { const r = await fetch('/api/friend-whitelist'); const d = await r.json(); if (d.success) whitelist.value = d.data } catch {}
}
async function addWhitelist() {
  const val = String(whitelistInput.value || '').trim()
  const qq = Number(val)
  if (!val || !qq || isNaN(qq)) { whitelistMsg.value = '请输入有效的 QQ 号'; return }
  whitelistLoading.value = true
  try { const r = await fetch('/api/friend-whitelist/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({qq}) }); const d = await r.json(); if (d.success) { whitelist.value = d.data; whitelistInput.value = ''; whitelistMsg.value = '' } else whitelistMsg.value = d.error } catch { whitelistMsg.value = '网络错误' }
  whitelistLoading.value = false
}
async function removeWhitelist(qq: number) {
  whitelistLoading.value = true
  try { const r = await fetch('/api/friend-whitelist/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({qq}) }); const d = await r.json(); if (d.success) whitelist.value = d.data } catch {}
  whitelistLoading.value = false
}
async function fetchFriendRequests() {
  frLoading.value = true
  try { const r = await fetch('/api/friend-requests'); const d = await r.json(); if (d.success) friendRequests.value = d.data } catch {}
  frLoading.value = false
}
async function handleFriendReq(flag: string, approve: boolean) {
  frLoading.value = true
  try { const r = await fetch('/api/friend-requests/handle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({flag, approve}) }); const d = await r.json(); if (d.success) { frMsg.value = approve ? '已同意' : '已拒绝'; await fetchFriendRequests() } else frMsg.value = d.error } catch { frMsg.value = '网络错误' }
  frLoading.value = false; setTimeout(() => frMsg.value = '', 2000)
}
function statusLabel(s: string) { return s === 'approved' ? '已同意' : s === 'rejected' ? '已拒绝' : '待处理' }
function statusStyle(s: string) { return s === 'approved' ? 'color:var(--success)' : s === 'rejected' ? 'color:var(--destructive)' : 'color:var(--warning)' }
function fmtTime(t: string) { try { return new Date(t).toLocaleString('zh-CN', { hour12: false }) } catch { return t } }

// Reduce X-axis labels to at most 6 evenly-spaced ticks (shared helper)
function reduceLabels(labels: string[]): string[] {
  if (labels.length <= 6) return labels
  const step = (labels.length - 1) / 5
  return [0, 1, 2, 3, 4, 5].map(i => labels[Math.round(i * step)])
}

// ================= Unified SVG Chart Primitives =================
const CHART_PAD = 4

function toPoints(data: number[], w: number, h: number): { x: number; y: number }[] {
  if (!data.length) return []
  const max = Math.max(...data, 1)
  const pw = w - CHART_PAD * 2
  const ph = h - CHART_PAD * 2
  return data.map((v, i) => ({
    x: data.length > 1 ? CHART_PAD + (i / (data.length - 1)) * pw : w / 2,
    y: CHART_PAD + (1 - v / max) * ph
  }))
}

function buildSmoothLine(data: number[], w: number, h: number): string {
  const pts = toPoints(data, w, h)
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x - 15},${pts[0].y} L ${pts[0].x + 15},${pts[0].y}`
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1].x + pts[i].x) / 2
    d += ` C ${cx},${pts[i - 1].y} ${cx},${pts[i].y} ${pts[i].x},${pts[i].y}`
  }
  return d
}

function buildSmoothArea(data: number[], w: number, h: number): string {
  const line = buildSmoothLine(data, w, h)
  if (!line) return ''
  const pts = toPoints(data, w, h)
  if (pts.length <= 1) {
    const y = pts[0]?.y ?? h - CHART_PAD
    const cx = pts[0]?.x ?? w / 2
    return `M ${cx - 15},${y} L ${cx + 15},${y} L ${cx + 15},${h - CHART_PAD} L ${cx - 15},${h - CHART_PAD} Z`
  }
  const lastX = pts[pts.length - 1].x
  return `${line} L ${lastX},${h - CHART_PAD} L ${CHART_PAD},${h - CHART_PAD} Z`
}

function getChartPointX(data: number[], i: number, w: number = 400): number {
  return toPoints(data, w, 120)[i]?.x ?? w / 2
}

function getChartPointY(data: number[], i: number, h: number = 120): number {
  return toPoints(data, 400, h)[i]?.y ?? h - CHART_PAD
}

function buildBarChartPath(data: number[], w: number, h: number): { path: string; tops: { x: number; y: number }[] } {
  if (!data.length) return { path: '', tops: [] }
  const max = Math.max(...data, 1)
  const gap = 2
  const rawW = (w - gap * (data.length + 1)) / data.length
  const barW = Math.min(rawW, 40)
  const total = data.length * barW + (data.length - 1) * gap
  const off = (w - total) / 2
  const tops: { x: number; y: number }[] = []
  let path = ''
  data.forEach((v, i) => {
    const x = off + i * (barW + gap)
    const bh = (v / max) * (h - CHART_PAD)
    const y = h - bh
    const r = Math.min(barW / 2, 3)
    path += `M ${x + r},${y} L ${x + barW - r},${y} A ${r},${r} 0 0 1 ${x + barW},${y + r} L ${x + barW},${h} L ${x},${h} L ${x},${y + r} A ${r},${r} 0 0 1 ${x + r},${y} Z `
    tops.push({ x: x + barW / 2, y })
  })
  return { path, tops }
}

// ================= Overview Chart Tooltip =================
const logContainer = ref<HTMLElement | null>(null)
const tip = ref({ show: false, x: 0, y: 0, title: '', text: '' })
const activeDot = ref(-1)
const activeDotChart = ref('')
const activeDotX = ref(0)
const activeDotY = ref(0)

function onChartMouseMove(e: MouseEvent, chart: any) {
  const chartEl = (e.target as HTMLElement).closest('.chart-main')
  if (!chartEl) return
  const rect = chartEl.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const relX = mouseX / rect.width
  const svgX = relX * 400

  let nearestIdx = 0, nearestDist = Infinity
  for (let i = 0; i < chart.data.length; i++) {
    const px = getChartPointX(chart.data, i)
    const dist = Math.abs(svgX - px)
    if (dist < nearestDist) { nearestDist = dist; nearestIdx = i }
  }

  if (nearestDist > 60) { tip.value.show = false; activeDot.value = -1; return }

  activeDot.value = nearestIdx
  activeDotChart.value = chart.id
  activeDotX.value = getChartPointX(chart.data, nearestIdx)
  activeDotY.value = getChartPointY(chart.data, nearestIdx)

  const dotScreenX = rect.left + (activeDotX.value / 400) * rect.width
  const dotScreenY = rect.top + (activeDotY.value / 120) * rect.height

  tip.value = {
    show: true,
    x: dotScreenX,
    y: dotScreenY - 8,
    title: chart.xLabels[nearestIdx] || '',
    text: `${chart.tooltipTitle}: ${chart.tooltipLabels[nearestIdx]}`
  }
}

function onChartMouseLeave() {
  tip.value.show = false
  activeDot.value = -1
}

// Auto-scroll to bottom when new logs arrive
watch(() => filteredSearchLogs.value.length, async () => {
  if (autoScroll.value && logContainer.value) {
    await nextTick()
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})

// When switching to logs tab, scroll to bottom
watch(activeTab, async (tab) => {
  if (tab === 'logs') {
    await nextTick()
    await nextTick()
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  }
})

onMounted(() => {
  fetch('/api/version').then(r => r.json()).then(d => { if (d.success) VERSION.value = d.version }).catch(() => { VERSION.value = '?' })
  usageMonth.value = new Date().toISOString().slice(0, 7)
  connect(); fetchTokenStats(); fetchGroups(); fetchSettingsData(); fetchSysConfig(); fetchFeatures()
  fetchWhitelist(); fetchFriendRequests()
  const t1 = setInterval(fetchTokenStats, 60000)
  const t2 = setInterval(fetchGroups, 300000)
  const t4 = setInterval(fetchSettingsData, 120000)
  const t5 = setInterval(fetchSysConfig, 120000)
  const t6 = setInterval(fetchFeatures, 120000)
  const t7 = setInterval(fetchWhitelist, 120000)
  const t8 = setInterval(fetchFriendRequests, 60000)
  // Sample memory every 5s
  const t3 = setInterval(() => {
    if (wsConnected.value) {
      memoryHistory.value.push(metrics.value.memoryMB)
      if (memoryHistory.value.length > maxHistoryPoints) memoryHistory.value.shift()
    }
  }, 5000)
  onUnmounted(() => { ws?.close(); if (cliResultTimer.value) clearTimeout(cliResultTimer.value); clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4); clearInterval(t5); clearInterval(t6); clearInterval(t7); clearInterval(t8) })
})
</script>

<template>
  <div class="app">
    <aside class="sidebar" :class="{ collapsed: !sidebarOpen }">
      <div class="sidebar-header">
        <img src="/xingye-logo.png" alt="星野" class="sidebar-logo" />
        <div v-if="sidebarOpen" class="sidebar-brand">
          <div class="brand-row"><span class="brand-name">星野</span><span class="brand-ver">{{ VERSION }}</span></div>
          <div class="brand-sub">QQ 机器人控制台</div>
        </div>
      </div>
      <div class="sidebar-nav-wrap">
        <nav class="sidebar-nav">
          <button v-for="item in navItems" :key="item.key" @click="activeTab = item.key" class="nav-item" :class="{ active: activeTab === item.key }">
            <span class="nav-icon" v-html="item.icon"></span>
            <span v-if="sidebarOpen" class="nav-text"><span class="nav-label">{{ item.label }}</span><span class="nav-desc">{{ item.desc }}</span></span>
          </button>
        </nav>
      </div>
      <div class="sidebar-footer"><div class="copyright">© 2026 Xingye Bot</div></div>
    </aside>

    <div class="main">
      <header class="header">
        <button class="header-toggle" @click="sidebarOpen = !sidebarOpen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>
        </button>
        <div class="header-divider"></div>
        <div class="header-title-group">
          <span class="header-icon" v-html="currentNavIcon"></span>
          <h1 class="header-title">{{ currentNavLabel }}</h1>
          <span class="header-desc">{{ currentNavDesc }}</span>
        </div>
        <div class="header-right">
          <span class="status-badge" :class="wsConnected ? 'online' : 'offline'"><span class="status-dot"></span>{{ wsConnected ? '已连接' : '未连接' }}</span>
        </div>
      </header>

      <main class="main-scroll" :class="{ 'no-scroll': activeTab === 'logs' }">
        <div class="content-wrapper">

          <!-- 总览 -->
          <div v-if="activeTab === 'overview'">
            <div class="stat-grid">
              <div v-for="(c, idx) in statCards" :key="c.label" class="stat-card anim-fade-up" :style="{ animationDelay: idx * 60 + 'ms' }">
                <div class="stat-icon"><span v-html="c.icon"></span></div>
                <div class="stat-body">
                  <p class="stat-label">{{ c.label }}</p>
                  <div class="stat-value">{{ c.val }}</div>
                  <p class="stat-sub" :class="{ 'text-destructive': c.isError }">{{ c.sub }}</p>
                </div>
              </div>
            </div>

            <div class="panel-row anim-fade-up" style="animation-delay:300ms">
              <div class="panel">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">⚡</span> 主机资源</div><div class="panel-desc">Bot Backend · Node.js</div></div></div>
                <div class="panel-body">
                  <div class="resource-grid">
                    <div class="resource-card">
                      <div class="resource-head"><span class="resource-label">内存使用</span><span class="resource-val">{{ metrics.memoryMB }} MB</span></div>
                      <div class="progress"><div class="progress-fill" :style="{ width: Math.min(100, metrics.memoryMB / 2) + '%' }"></div></div>
                      <div class="resource-foot"><span>GC {{ metrics.gcMemoryMB }} MB</span><span>工作集 {{ metrics.memoryMB }} MB</span></div>
                    </div>
                    <div class="resource-card">
                      <div class="resource-head"><span class="resource-label">指令处理</span><span class="resource-val">{{ metrics.commandsHandled.toLocaleString() }}</span></div>
                      <div class="progress"><div class="progress-fill" :style="{ width: Math.min(100, metrics.commandsHandled / 10) + '%' }"></div></div>
                    </div>
                    <div class="resource-card">
                      <div class="resource-head"><span class="resource-label">Token 消耗</span><span class="resource-val">{{ totalTokens.toLocaleString() }}</span></div>
                      <div class="progress"><div class="progress-fill" :style="{ width: totalTokens > 0 ? '55%' : '0%' }"></div></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="panel">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">🔔</span> 最近告警</div><div class="panel-desc">最近 5 条 · WARN / ERROR</div></div><button class="panel-link" @click="activeTab = 'logs'">查看日志 →</button></div>
                <div class="panel-body">
                  <div class="log-list">
                    <div v-for="(log, i) in filteredLogs.filter(l => l.level !== 'info').slice(-5).reverse()" :key="i" class="log-item-simple anim-fade-in" :style="{ animationDelay: i * 40 + 'ms' }">
                      <span class="log-time">{{ log.timestamp }}</span>
                      <span class="log-tag" :style="{ color: logColor(log.level) }">{{ log.level.toUpperCase() }}</span>
                      <span class="log-msg">{{ log.message }}</span>
                    </div>
                    <div v-if="filteredLogs.filter(l => l.level !== 'info').length === 0" class="empty-state">暂无告警</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="panel-row anim-fade-up" style="animation-delay:450ms">
              <div class="panel" v-for="(chart, ci) in charts" :key="chart.id">
                <div class="panel-header"><div><div class="panel-title">{{ chart.title }}</div><div class="panel-desc">{{ chart.val }}</div></div></div>
                <div class="panel-body">
                  <div v-if="chart.data.length >= 1" class="chart-container">
                    <div class="chart-y-axis">
                      <span v-for="label in chart.yLabels" :key="label">{{ label }}</span>
                    </div>
                    <div class="chart-main" @mousemove="(e: MouseEvent) => onChartMouseMove(e, chart)" @mouseleave="onChartMouseLeave">
                      <svg viewBox="0 0 400 120" preserveAspectRatio="none" class="chart-svg">
                        <defs>
                          <linearGradient :id="'ag'+ci" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.3"/>
                            <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
                          </linearGradient>
                        </defs>
                        <line v-for="y in [0, 0.25, 0.5, 0.75, 1]" :key="y" x1="0" :y1="120 * y" x2="400" :y2="120 * y" stroke="var(--border)" stroke-width="0.5" opacity="0.5" />
                        <path :d="buildSmoothArea(chart.data, 400, 120)" :fill="`url(#ag${ci})`" />
                        <path :d="buildSmoothLine(chart.data, 400, 120)" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        <circle v-if="activeDot >= 0 && activeDotChart === chart.id && chart.data.length > 1"
                          :cx="activeDotX" :cy="activeDotY"
                          r="4" fill="#6366f1" stroke="var(--card)" stroke-width="2" />
                      </svg>
                    </div>
                    <div class="chart-x-axis">
                      <span v-for="label in chart.xLabels" :key="label">{{ label }}</span>
                    </div>
                  </div>
                  <div v-else class="empty-chart">暂无数据</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 用量 -->
          <div v-if="activeTab === 'usage'">
            <div class="usage-header">
              <div class="usage-header-left">
                <h2 class="usage-title">用量信息</h2>
                <p class="usage-subtitle">所有日期按 UTC+8 时间显示，数据可能有延迟</p>
              </div>
              <div class="usage-header-right">
                <select v-model="usageMonth" class="select-input select-sm">
                  <option v-for="m in usageMonthOptions" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>

            <div class="usage-summary-grid anim-fade-up" style="animation-delay:60ms">
              <div class="usage-summary-card">
                <div class="usage-summary-label">本月总 Token</div>
                <div class="usage-summary-val">{{ usageSummary.totalTokens.toLocaleString() }}</div>
              </div>
              <div class="usage-summary-card">
                <div class="usage-summary-label">总请求数</div>
                <div class="usage-summary-val">{{ usageSummary.totalRequests.toLocaleString() }}</div>
              </div>
              <div class="usage-summary-card">
                <div class="usage-summary-label">平均 Token/次</div>
                <div class="usage-summary-val">{{ Math.round(usageSummary.avgTokensPerReq).toLocaleString() }}</div>
              </div>
              <div class="usage-summary-card">
                <div class="usage-summary-label">活跃天数</div>
                <div class="usage-summary-val">{{ usageSummary.days }}</div>
              </div>
            </div>

            <div class="panel anim-fade-up" style="animation-delay:120ms;margin-top:16px">
              <div class="panel-header">
                <div><div class="panel-title"><span class="panel-title-icon">📊</span> 每日 Token 消耗</div><div class="panel-desc">柱状图 · 按日统计</div></div>
                <div class="panel-badge">{{ usageSummary.totalTokens.toLocaleString() }}</div>
              </div>
              <div class="panel-body">
                <div v-if="usageSpendingData.dates.length > 0" class="usage-chart-wrap">
                  <div class="usage-y-axis">
                    <span v-for="l in usageSpendingData.yLabels" :key="l">{{ l }}</span>
                  </div>
                  <div class="usage-chart-main" @mousemove="(e: MouseEvent) => onUsageBarMouseMove(e, usageSpendingData, 'spend')" @mouseleave="() => onUsageMouseLeave('spend')">
                    <svg viewBox="0 0 600 160" preserveAspectRatio="none" class="usage-chart-svg">
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.9"/>
                          <stop offset="100%" stop-color="#6366f1" stop-opacity="0.4"/>
                        </linearGradient>
                      </defs>
                      <line v-for="y in [0, 0.33, 0.66, 1]" :key="y" x1="0" :y1="160 * y" x2="600" :y2="160 * y" stroke="var(--border)" stroke-width="0.5" opacity="0.4"/>
                      <path :d="buildBarChartPath(usageSpendingData.values, 600, 160).path" fill="url(#barGrad)" rx="2"/>
                    </svg>
                  </div>
                  <div class="usage-x-axis">
                    <span v-for="l in usageSpendingData.xLabels" :key="l">{{ l }}</span>
                  </div>
                </div>
                <div v-else class="empty-chart">暂无数据</div>
              </div>
            </div>

            <div class="usage-dual-row anim-fade-up" style="animation-delay:180ms">
              <div class="panel">
                <div class="panel-header">
                  <div><div class="panel-title">API 请求次数</div><div class="panel-desc">{{ usageRequestData.values.reduce((a: number, b: number) => a + b, 0).toLocaleString() }} 次</div></div>
                </div>
                <div class="panel-body">
                  <div v-if="usageRequestData.dates.length > 0" class="usage-chart-wrap">
                    <div class="usage-y-axis">
                      <span v-for="l in usageRequestData.yLabels" :key="l">{{ l }}</span>
                    </div>
                    <div class="usage-chart-main" @mousemove="(e: MouseEvent) => onUsageLineMouseMove(e, usageRequestData, 'req')" @mouseleave="() => onUsageMouseLeave('req')">
                      <svg viewBox="0 0 600 140" preserveAspectRatio="none" class="usage-chart-svg">
                        <defs>
                          <linearGradient id="reqArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.3"/>
                            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
                          </linearGradient>
                        </defs>
                        <line v-for="y in [0, 0.33, 0.66, 1]" :key="y" x1="0" :y1="140 * y" x2="600" :y2="140 * y" stroke="var(--border)" stroke-width="0.5" opacity="0.4"/>
                        <path :d="buildSmoothArea(usageRequestData.values, 600, 140)" fill="url(#reqArea)"/>
                        <path :d="buildSmoothLine(usageRequestData.values, 600, 140)" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                    <div class="usage-x-axis">
                      <span v-for="l in usageRequestData.xLabels" :key="l">{{ l }}</span>
                    </div>
                  </div>
                  <div v-else class="empty-chart">暂无数据</div>
                </div>
              </div>
              <div class="panel">
                <div class="panel-header">
                  <div><div class="panel-title">Token 用量</div><div class="panel-desc">{{ usageSummary.totalTokens.toLocaleString() }} tokens</div></div>
                </div>
                <div class="panel-body">
                  <div v-if="usageTokenDetailData.dates.length > 0" class="usage-chart-wrap">
                    <div class="usage-y-axis">
                      <span v-for="l in usageTokenDetailData.yLabels" :key="l">{{ l }}</span>
                    </div>
                    <div class="usage-chart-main" @mousemove="(e: MouseEvent) => onUsageLineMouseMove(e, usageTokenDetailData, 'tok', true)" @mouseleave="() => onUsageMouseLeave('tok')">
                      <svg viewBox="0 0 600 140" preserveAspectRatio="none" class="usage-chart-svg">
                        <defs>
                          <linearGradient id="tokOut" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.5"/>
                            <stop offset="100%" stop-color="#a78bfa" stop-opacity="0.05"/>
                          </linearGradient>
                          <linearGradient id="tokIn" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.5"/>
                            <stop offset="100%" stop-color="#6366f1" stop-opacity="0.05"/>
                          </linearGradient>
                        </defs>
                        <line v-for="y in [0, 0.33, 0.66, 1]" :key="y" x1="0" :y1="140 * y" x2="600" :y2="140 * y" stroke="var(--border)" stroke-width="0.5" opacity="0.4"/>
                        <path :d="buildSmoothArea(usageTokenDetailData.input.map((v: number, i: number) => v + usageTokenDetailData.output[i]), 600, 140)" fill="url(#tokOut)"/>
                        <path :d="buildSmoothLine(usageTokenDetailData.input.map((v: number, i: number) => v + usageTokenDetailData.output[i]), 600, 140)" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path :d="buildSmoothArea(usageTokenDetailData.input, 600, 140)" fill="url(#tokIn)"/>
                        <path :d="buildSmoothLine(usageTokenDetailData.input, 600, 140)" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <g transform="translate(20, 10)">
                          <rect width="10" height="10" rx="2" fill="#a78bfa" opacity="0.6"/>
                          <text x="14" y="9" font-size="10" fill="var(--muted-foreground)">总 Token</text>
                          <rect x="80" width="10" height="10" rx="2" fill="#6366f1" opacity="0.6"/>
                          <text x="94" y="9" font-size="10" fill="var(--muted-foreground)">输入 Token</text>
                        </g>
                      </svg>
                    </div>
                    <div class="usage-x-axis">
                      <span v-for="l in usageTokenDetailData.xLabels" :key="l">{{ l }}</span>
                    </div>
                  </div>
                  <div v-else class="empty-chart">暂无数据</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 设置 -->
          <div v-if="activeTab === 'settings'" class="settings-page">
            <div class="settings-header">
              <h2 class="usage-title">功能设置</h2>
              <p class="usage-subtitle">管理绑定、订阅与系统配置</p>
            </div>

            <div v-if="settingsMsg" class="settings-toast">{{ settingsMsg }}</div>

            <div class="settings-grid">

              <!-- Steam 订阅管理 -->
              <div class="panel settings-card">
                <div class="panel-header">
                  <div><div class="panel-title"><span class="panel-title-icon">📦</span> Steam 订阅管理</div><div class="panel-desc">管理所有用户的 Steam 促销订阅</div></div>
                  <div class="panel-badge">{{ allSubscriptions.reduce((s, e) => s + e.subscriptions.length, 0) }}</div>
                </div>
                <div class="panel-body settings-body">
                  <div v-if="settingsLoading" class="empty-chart">加载中...</div>
                  <div v-else-if="allSubscriptions.length === 0" class="empty-chart">暂无订阅</div>
                  <div v-else class="settings-list">
                    <div v-for="entry in allSubscriptions" :key="entry.userId" class="settings-item">
                      <div class="settings-item-head">
                        <span class="settings-user-id">QQ {{ entry.userId }}</span>
                        <span class="settings-badge">{{ entry.subscriptions.length }} 项</span>
                      </div>
                      <div class="settings-subs">
                        <div v-for="(sub, i) in entry.subscriptions" :key="i" class="settings-sub">
                          <span>{{ sub.type === 'general' ? '📢 总促销' : `🎮 ${sub.gameName || 'AppID ' + sub.appId}` }}</span>
                          <button class="btn-xs" @click="doUnsubscribe(entry.userId, sub.type, sub.appId)">取消</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 游戏账号绑定 -->
              <div class="panel settings-card">
                <div class="panel-header">
                  <div><div class="panel-title"><span class="panel-title-icon">🎮</span> 游戏账号绑定</div><div class="panel-desc">5E / Steam 账号绑定管理</div></div>
                  <div class="panel-badge">{{ allBindings.reduce((s, e) => s + e.accounts.length, 0) }}</div>
                </div>
                <div class="panel-body settings-body">
                  <div v-if="settingsLoading" class="empty-chart">加载中...</div>
                  <div v-else-if="allBindings.length === 0" class="empty-chart">暂无绑定</div>
                  <div v-else class="settings-list">
                    <div v-for="entry in allBindings" :key="entry.userId" class="settings-item">
                      <div class="settings-item-head">
                        <span class="settings-user-id">QQ {{ entry.userId }}</span>
                        <span class="settings-badge">{{ entry.accounts.length }} 项</span>
                      </div>
                      <div class="settings-subs">
                        <div v-for="(acc, i) in entry.accounts" :key="i" class="settings-sub">
                          <span>{{ acc.platform === '5e' ? '🔫' : '🟦' }} {{ acc.platform.toUpperCase() }} · {{ acc.label }}<span class="settings-acc-id">{{ acc.accountId }}</span></span>
                          <button class="btn-xs" @click="doUnbind(entry.userId, acc.platform, acc.accountId)">解绑</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 已知群组 -->
              <div class="panel settings-card">
                <div class="panel-header">
                  <div><div class="panel-title"><span class="panel-title-icon">💬</span> 已知群组</div><div class="panel-desc">Bot 已加入或识别到的群</div></div>
                  <div class="panel-badge">{{ allGroups.length }}</div>
                </div>
                <div class="panel-body settings-body">
                  <div v-if="settingsLoading" class="empty-chart">加载中...</div>
                  <div v-else-if="allGroups.length === 0" class="empty-chart">暂无群组</div>
                  <div v-else class="settings-list">
                    <div v-for="g in allGroups" :key="g.id" class="settings-item">
                      <div class="settings-item-head">
                        <span class="settings-user-id">{{ g.name }}</span>
                        <span class="settings-acc-id">{{ g.id }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 功能开关 -->
              <div class="panel settings-card settings-card-wide">
                <div class="panel-header">
                  <div><div class="panel-title"><span class="panel-title-icon">🔘</span> 功能开关</div><div class="panel-desc">开启/关闭各功能模块，切换后即时生效</div></div>
                </div>
                <div class="panel-body settings-body">
                  <div v-for="cat in featureCategories" :key="cat.name" class="feature-category">
                    <div class="feature-category-title">{{ cat.name }}</div>
                    <div class="feature-grid">
                      <div v-for="item in cat.items" :key="item.key" class="feature-item">
                        <label class="feature-label">
                          <span class="feature-name">{{ item.label }}</span>
                          <span class="feature-desc">{{ item.desc }}</span>
                        </label>
                        <button
                          class="toggle-btn"
                          :class="{ on: featureFlags[item.key] !== false }"
                          @click="toggleFeature(item.key, (featureFlags[item.key] ?? true) === false)"
                        >
                          <span class="toggle-knob"></span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 系统配置 -->
              <div class="panel settings-card">
                <div class="panel-header">
                  <div><div class="panel-title"><span class="panel-title-icon">⚙️</span> 系统配置</div><div class="panel-desc">运行时参数（只读）</div></div>
                </div>
                <div class="panel-body settings-body">
                  <div class="settings-info-grid">
                    <div class="settings-info-row"><span class="settings-info-label">AI 模型</span><span>mimo-v2.5</span></div>
                    <div class="settings-info-row"><span class="settings-info-label">管理员</span><span>QQ 2994832083</span></div>
                    <div class="settings-info-row"><span class="settings-info-label">唤醒词</span><span>星野</span></div>
                    <div class="settings-info-row"><span class="settings-info-label">BOT QQ</span><span>3853499326</span></div>
                    <div class="settings-info-row"><span class="settings-info-label">SnowLuna</span><span :class="wsConnected ? 'text-success' : 'text-destructive'">{{ wsConnected ? '已连接' : '未连接' }}</span></div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- 系统设置 -->
          <div v-if="activeTab === 'sysconfig'">
            <div class="settings-header">
              <h2 class="usage-title">系统设置</h2>
              <p class="usage-subtitle">配置 Bot 运行参数与功能开关</p>
            </div>
            <div v-if="sysConfigMsg" class="settings-toast" :class="sysConfigMsg.includes('失败') ? 'error' : ''">{{ sysConfigMsg }}</div>

            <div class="settings-grid">

              <!-- 应用更新 -->
              <div style="background: rgba(30,41,59,0.6); border: 1px solid rgba(100,116,139,0.2); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <h3 style="font-size: 15px; font-weight: 600; color: #e2e8f0; margin-bottom: 12px;">🔄 应用更新</h3>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                  <span style="font-size: 13px; color: #94a3b8;">当前版本：</span>
                  <span style="font-size: 13px; color: #38bdf8; font-weight: 600;">v{{ VERSION }}</span>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                  <button @click="checkForUpdate" :disabled="updateChecking || updateApplying"
                    style="padding: 8px 16px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 500; opacity: 0.9; transition: all 0.2s;"
                    :style="{ opacity: (updateChecking || updateApplying) ? 0.5 : 0.9 }">
                    {{ updateChecking ? '检查中...' : '检查更新' }}
                  </button>
                  <button v-if="updateAvailable && !updateApplying" @click="applyUpdate"
                    style="padding: 8px 16px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 500;">
                    立即更新到 v{{ updateVersion }}
                  </button>
                </div>
                <div v-if="updateProgress" style="margin-top: 10px; padding: 10px; background: rgba(56,189,248,0.1); border-radius: 8px;">
                  <span style="font-size: 13px; color: #38bdf8;">⏳ {{ updateProgress }}</span>
                </div>
                <div v-if="updateError" style="margin-top: 10px; padding: 10px; background: rgba(34,197,94,0.1); border-radius: 8px;">
                  <span style="font-size: 13px; color: #22c55e;">✅ {{ updateError }}</span>
                </div>
              </div>

              <!-- 群唤醒管理 -->
              <div class="panel settings-card">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">🔔</span> 群唤醒管理</div><div class="panel-desc">选择允许通过「星野」唤醒的群聊</div></div><div class="panel-badge">{{ sysConfig.wakeEnabledGroups.length }}</div></div>
                <div class="panel-body settings-body">
                  <div class="sys-hint">不在列表中的群只能通过 @ 召唤</div>
                  <div class="sys-toggle-list">
                    <label v-for="g in allGroups" :key="g.id" class="sys-toggle-row">
                      <span class="sys-toggle-label">{{ g.name }}<span class="sys-toggle-id">{{ g.id }}</span></span>
                      <input type="checkbox" :checked="sysConfig.wakeEnabledGroups.includes(g.id)" @change="toggleWakeGroup(g.id)" class="sys-checkbox" />
                    </label>
                  </div>
                  <div v-if="allGroups.length === 0" class="empty-chart">暂无已加入的群聊</div>
                </div>
              </div>

              <!-- 群更新广播 -->
              <div class="panel settings-card settings-card-wide">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">📢</span> 群更新广播</div><div class="panel-desc">向群聊推送更新公告</div></div></div>
                <div class="panel-body settings-body">
                  <div class="sys-section">
                    <div class="sys-row"><span>广播功能</span><label class="sys-switch"><input type="checkbox" v-model="sysConfig.broadcastEnabled" @change="saveSysConfig" /><span class="sys-slider"></span></label></div>
                    <div class="sys-row"><span>仅管理员可触发</span><label class="sys-switch"><input type="checkbox" v-model="sysConfig.broadcastAdminOnly" @change="saveSysConfig" /><span class="sys-slider"></span></label></div>
                  </div>
                  <details class="sys-details">
                    <summary class="sys-summary">各群聊开关（{{ sysConfig.broadcastEnabledGroups.length }}）</summary>
                    <div class="sys-toggle-list" style="max-height:160px;overflow-y:auto">
                      <label v-for="g in allGroups" :key="g.id" class="sys-toggle-row">
                        <span class="sys-toggle-label">{{ g.name }}<span class="sys-toggle-id">{{ g.id }}</span></span>
                        <input type="checkbox" :checked="sysConfig.broadcastEnabledGroups.includes(g.id)" @change="toggleBroadcastGroup(g.id)" class="sys-checkbox" />
                      </label>
                    </div>
                  </details>
                  <div class="sys-section" style="margin-top:8px">
                    <div class="sys-row"><span>更新日志</span></div>
                    <textarea v-model="sysConfig.updateLog" class="sys-textarea" rows="4" placeholder="在此输入更新日志内容…"></textarea>
                    <div class="sys-row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
                      <button class="sys-btn sys-btn-primary" :disabled="!sysConfig.broadcastEnabled || !sysConfig.updateLog.trim()" @click="doBroadcast">📢 立即广播</button>
                      <button class="sys-btn" :disabled="sysConfigSaving" @click="saveSysConfig">💾 保存日志</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Prompt 设置 -->
              <div class="panel settings-card">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">🧠</span> Prompt 设置</div><div class="panel-desc">在线修改 AI 人格提示词</div></div></div>
                <div class="panel-body settings-body">
                  <div class="sys-hint">修改会立即生效，与聊天指令「调整prompt」同步</div>
                  <textarea v-model="sysConfig.customPrompt" class="sys-textarea" rows="6" placeholder="在此输入自定义 prompt…&#10;留空则使用默认 prompt"></textarea>
                  <div class="sys-row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
                    <button class="sys-btn sys-btn-primary" :disabled="sysConfigSaving" @click="saveSysConfig">💾 保存</button>
                    <button class="sys-btn sys-btn-danger" @click="promptConfirm = true">🔄 重置为默认</button>
                  </div>
                  <div v-if="promptConfirm" class="sys-confirm-overlay">
                    <div class="sys-confirm-box">
                      <div class="sys-confirm-text">确定重置为默认 prompt 吗？</div>
                      <div class="sys-row" style="gap:8px;justify-content:center">
                        <button class="sys-btn sys-btn-danger" @click="async () => { sysConfig.customPrompt = ''; await saveSysConfig(); promptConfirm = false }">确认重置</button>
                        <button class="sys-btn" @click="promptConfirm = false">取消</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 一键重启 & 关闭 -->
              <div class="panel settings-card">
                <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">⚡</span> 进程管理</div><div class="panel-desc">PM2 托管 · 重启自动拉起</div></div></div>
                <div class="panel-body settings-body">
                  <div class="sys-hint">重启：后端进程自动拉起 · 关闭：停止全部服务</div>
                  <div class="sys-row" style="gap:8px;flex-wrap:wrap">
                    <button class="sys-btn sys-btn-primary" :disabled="sysRestarting" @click="doRestart">🔄 重启后端</button>
                    <button class="sys-btn sys-btn-danger" :disabled="sysRestarting" @click="doShutdown">⏹ 关闭全部</button>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- 日志 -->
          <div v-if="activeTab === 'logs'" class="panel full-panel">
            <div class="log-header">
              <div class="log-header-left">
                <div class="log-title-row"><span class="log-title">运行日志</span><span class="live-badge"><span class="live-dot"></span>实时</span></div>
                <div class="log-meta">{{ filteredLogs.length }}/{{ logs.length }} 条 · SSE 实时推送 · 服务端 INFO</div>
              </div>
              <div class="log-header-right">
                <div class="log-search">
                  <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input v-model="logSearch" placeholder="搜索消息 / 模块 / 级别" class="search-input" />
                </div>
                <button class="icon-btn" title="下载日志" @click="downloadLogs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></button>
                <button class="icon-btn" title="清空日志" @click="clearLogs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
              </div>
            </div>
            <div class="log-filters">
              <button v-for="lv in logLevels" :key="lv.value" class="filter-tab" :class="{ active: logLevelFilter === lv.value }" @click="logLevelFilter = lv.value"><span class="filter-dot" :style="{ background: lv.color }"></span>{{ lv.label }}</button>
            </div>
            <div class="log-table-header"><span class="col-time">时间</span><span class="col-level">级别</span><span class="col-module">模块</span><span class="col-msg">消息</span></div>
            <div ref="logContainer" class="log-scroll">
              <div v-for="(log, i) in filteredSearchLogs" :key="i" class="log-row">
                <span class="col-time">{{ log.timestamp }}</span>
                <span class="col-level"><span class="level-badge" :class="'level-' + log.level"><span class="level-dot"></span>{{ log.level.toUpperCase() }}</span></span>
                <span class="col-module">[Event]</span>
                <span class="col-msg" :title="log.message">{{ log.message }}</span>
              </div>
              <div v-if="filteredSearchLogs.length === 0" class="empty-state">暂无日志</div>
            </div>
          </div>

          <!-- 消息 -->
          <div v-if="activeTab === 'messaging'" class="panel">
            <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">◈</span> 发送群消息</div><div class="panel-desc">选择目标群组</div></div></div>
            <div class="panel-body">
              <div class="msg-form">
                <select v-model="selectedGroupId" class="select-input"><option :value="null" disabled>选择群组...</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }} ({{ g.id }})</option></select>
                <input v-model="messageInput" @keydown.enter="sendMessage" placeholder="输入消息..." class="text-input flex1" />
                <button @click="sendMessage" :disabled="!selectedGroupId || !messageInput.trim() || sendLoading" class="btn-primary">{{ sendLoading ? '发送中...' : '发送' }}</button>
                <button @click="refreshGroups" class="btn-outline">刷新</button>
              </div>
              <div v-if="sendResult" class="msg-toast" :class="sendResult === '消息已发送' ? 'success' : 'error'">{{ sendResult }}</div>
            </div>
          </div>

          <!-- 终端 -->
          <div v-if="activeTab === 'cli'" class="panel">
            <div class="panel-header"><div><div class="panel-title"><span class="panel-title-icon">▹</span> Web CLI</div><div class="panel-desc">/status · /say · /restart · /help</div></div></div>
            <div class="panel-body">
              <div class="cli-box"><span class="cli-prompt">$</span><input id="cli-input" v-model="cliInput" @keydown.enter="sendCliCommand" placeholder="输入命令..." class="cli-input" /></div>
              <div v-if="cliResult" class="cli-result">{{ cliResult }}</div>
            </div>
          </div>

          <!-- 好友管理 -->
          <div v-if="activeTab === 'friendmgmt'" class="settings-page">
            <div class="settings-header">
              <h2 class="usage-title">好友管理</h2>
              <p class="usage-subtitle">白名单自动同意 & 手动处理好友申请</p>
            </div>
            <div v-if="whitelistMsg || frMsg" class="settings-toast">{{ whitelistMsg || frMsg }}</div>

            <div class="panel anim-fade-up" style="animation-delay:60ms">
              <div class="panel-header">
                <div><div class="panel-title"><span class="panel-title-icon">➕</span> 好友白名单</div><div class="panel-desc">白名单中的 QQ 发好友申请会自动通过</div></div>
                <div class="panel-badge">{{ whitelist.length }} 个</div>
              </div>
              <div class="panel-body">
                <div class="msg-form">
                  <input v-model="whitelistInput" @keydown.enter="addWhitelist" placeholder="输入 QQ 号..." inputmode="numeric" pattern="[0-9]*" class="text-input flex1" />
                  <button @click="addWhitelist" :disabled="!(whitelistInput+'').trim() || whitelistLoading" class="btn-primary">添加</button>
                </div>
                <div v-if="whitelist.length > 0" class="settings-list" style="margin-top:12px">
                  <div v-for="(qq, i) in whitelist" :key="qq" class="settings-item">
                    <div class="settings-item-head">
                      <span class="settings-user-id">{{ qq }}</span>
                      <div><span class="settings-badge">第 {{ i + 1 }} 项</span><button class="btn-xs" style="margin-left:8px" @click="removeWhitelist(qq)">移除</button></div>
                    </div>
                  </div>
                </div>
                <div v-else-if="!whitelistLoading" class="empty-chart" style="margin-top:12px">暂无白名单 QQ</div>
              </div>
            </div>

            <div class="panel anim-fade-up" style="animation-delay:120ms;margin-top:16px">
              <div class="panel-header">
                <div><div class="panel-title"><span class="panel-title-icon">📋</span> 好友申请记录</div><div class="panel-desc">共 {{ friendRequests.length }} 条 · 按申请时间降序</div></div>
                <button class="btn-outline" @click="fetchFriendRequests" :disabled="frLoading" style="font-size:11px">刷新</button>
              </div>
              <div class="panel-body" style="max-height:400px;overflow-y:auto">
                <div v-if="frLoading" class="empty-chart">加载中...</div>
                <div v-else-if="friendRequests.length === 0" class="empty-chart">暂无好友申请记录</div>
                <div v-else class="settings-list">
                  <div v-for="req in friendRequests" :key="req.flag" class="settings-item">
                    <div class="settings-item-head">
                      <span class="settings-user-id">{{ req.qq }}</span>
                      <div>
                        <span class="settings-badge" :style="statusStyle(req.status)">{{ statusLabel(req.status) }}</span>
                        <span class="settings-acc-id">{{ fmtTime(req.time) }}</span>
                      </div>
                    </div>
                    <div style="margin-top:4px;font-size:12px;color:var(--muted-foreground)">
                      <div>备注: {{ req.comment || '(无)' }}</div>
                      <div v-if="req.handledAt">处理时间: {{ fmtTime(req.handledAt) }}</div>
                    </div>
                    <div v-if="req.status === 'pending'" style="margin-top:8px;display:flex;gap:6px">
                      <button class="btn-primary" style="font-size:11px;padding:4px 12px" @click="handleFriendReq(req.flag, true)" :disabled="frLoading">同意</button>
                      <button class="btn-xs" style="font-size:11px;padding:4px 12px;background:oklch(from var(--destructive) l c h / 0.15);color:var(--destructive);border:none;border-radius:5px;cursor:pointer" @click="handleFriendReq(req.flag, false)" :disabled="frLoading">拒绝</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="tip.show" class="chart-tooltip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      <div class="tooltip-title">{{ tip.title }}</div>
      <div class="tooltip-value">{{ tip.text }}</div>
    </div>
    <div v-if="usageTip.show" class="usage-tooltip" :style="{ left: usageTip.x + 'px', top: usageTip.y + 'px' }">{{ usageTip.text }}</div>
  </Teleport>
</template>


<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --background: #151b28;
  --foreground: #e2e8f0;
  --card: #1c2333;
  --card-foreground: #e2e8f0;
  --primary: #a78bfa;
  --primary-foreground: #ffffff;
  --secondary: #232b3d;
  --muted: #1e2640;
  --muted-foreground: #8892a8;
  --accent: #232b3d;
  --accent-foreground: #e2e8f0;
  --destructive: #ef4444;
  --warning: #f59e0b;
  --success: #22c55e;
  --border: #2a3348;
  --ring: #a78bfa;
  --radius: 0.75rem;
  --sidebar-bg: #111724;
  --sidebar-border: #1f2740;
  --sidebar-accent: #1c2333;
  --header-bg: rgba(21, 27, 40, 0.85);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body {
  background: var(--background); color: var(--foreground);
  font-family: 'Inter', 'Noto Sans SC', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
select option { background: var(--card); color: var(--foreground); }

.app { display: flex; height: 100vh; width: 100vw; overflow: hidden; }

/* ========== Sidebar ========== */
.sidebar {
  position: relative; height: 100%; flex-shrink: 0; overflow: hidden;
  border-right: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg);
  display: flex; flex-direction: column;
  transition: width 0.2s ease;
  width: 248px;
}
.sidebar.collapsed { width: 0; border-right: none; }
.sidebar-header {
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px; height: 64px; flex-shrink: 0;
  border-bottom: 1px solid var(--sidebar-border);
}
.sidebar-logo {
  width: 36px; height: 36px; border-radius: 12px; flex-shrink: 0;
  object-fit: cover;
}
.sidebar-brand { min-width: 0; flex: 1; }
.brand-row { display: flex; align-items: baseline; gap: 6px; }
.brand-name { font-size: 14px; font-weight: 700; letter-spacing: -0.02em; color: var(--foreground); }
.brand-ver { font-size: 10px; font-weight: 500; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.brand-sub { font-size: 10px; color: var(--muted-foreground); }

.sidebar-nav-wrap { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; }
.sidebar-nav { padding: 8px; display: flex; flex-direction: column; gap: 2px; }

.nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: var(--radius);
  border: none; background: transparent;
  color: var(--muted-foreground); cursor: pointer;
  font-size: 14px; font-weight: 500;
  transition: all 0.15s ease;
  width: 100%; text-align: left;
  position: relative;
}
.nav-item:hover { background: oklch(from var(--sidebar-accent) l c h / 0.4); color: var(--foreground); }
.nav-item.active {
  background: var(--sidebar-accent); color: var(--foreground);
  box-shadow: inset 0 0 0 1px oklch(from var(--primary) l c h / 0.2);
}
.nav-item.active::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 3px; height: 20px; border-radius: 0 3px 3px 0;
  background: var(--primary);
}
.nav-icon { display: flex; width: 16px; height: 16px; flex-shrink: 0; position: relative; z-index: 1; opacity: 0.7; }
.nav-item.active .nav-icon { opacity: 1; color: var(--primary); }
.nav-text { display: flex; flex-direction: column; min-width: 0; flex: 1; position: relative; z-index: 1; }
.nav-label { line-height: 1.2; }
.nav-desc { font-size: 10px; font-weight: 400; color: var(--muted-foreground); }

.sidebar-footer { padding: 12px 16px; flex-shrink: 0; }
.copyright { font-size: 10px; color: var(--muted-foreground); }

/* ========== Main ========== */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.header {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 8px;
  height: 64px; flex-shrink: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--header-bg);
  backdrop-filter: blur(20px) saturate(1.5);
}
.header-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px;
  border: none; background: transparent;
  color: var(--muted-foreground); cursor: pointer;
  transition: all 0.15s;
}
.header-toggle:hover { background: var(--accent); color: var(--foreground); }
.header-divider { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }
.header-title-group { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.header-icon { color: var(--primary); display: flex; }
.header-title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.header-desc { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
.header-right { display: flex; align-items: center; gap: 8px; }

.status-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 10px; border-radius: 9999px;
  font-size: 11px; font-weight: 500;
  border: 1px solid transparent;
}
.status-badge.online { background: oklch(from var(--success) l c h / 0.15); color: var(--success); }
.status-badge.offline { background: oklch(from var(--destructive) l c h / 0.15); color: var(--destructive); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; }
.status-badge.online .status-dot { background: var(--success); animation: pulse 2s infinite; }
.status-badge.offline .status-dot { background: var(--destructive); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.main-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.main-scroll.no-scroll { overflow: hidden; }
.content-wrapper {
  max-width: 80rem; margin: 0 auto;
  padding: 20px 16px;
}
@media (min-width: 640px) { .content-wrapper { padding: 24px 24px; } }
@media (min-width: 1024px) { .content-wrapper { padding: 24px 32px; } }

/* ========== Stat Cards ========== */
.stat-grid {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
@media (min-width: 1024px) { .stat-grid { grid-template-columns: repeat(5, 1fr); } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--card); color: var(--card-foreground);
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  transition: all 0.15s ease;
  overflow: hidden;
}
.stat-card.clickable { cursor: pointer; }
.stat-card:hover { border-color: oklch(from var(--primary) l c h / 0.4); background: oklch(from var(--accent) l c h / 0.3); }

.stat-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  background: oklch(from var(--primary) l c h / 0.1); color: var(--primary);
}
.stat-body { min-width: 0; flex: 1; }
.stat-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); line-height: 1.2; }
.stat-value { margin-top: 4px; font-size: 18px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat-sub { margin-top: 4px; font-size: 11px; color: var(--muted-foreground); }
.text-destructive { color: var(--destructive) !important; }
.stat-arrow { flex-shrink: 0; color: var(--muted-foreground); opacity: 0.6; }

/* ========== Panels ========== */
.panel-row { display: grid; gap: 16px; margin-top: 16px; grid-template-columns: 1fr; }
@media (min-width: 1024px) { .panel-row { grid-template-columns: 1fr 1fr; } }

.panel {
  display: flex; flex-direction: column;
  border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--card); color: var(--card-foreground);
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  overflow: hidden;
}
.full-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; max-height: calc(100vh - 96px); margin: 0 20px 32px 20px; }

.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.panel-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.panel-title-icon { font-size: 14px; color: var(--primary); }
.panel-desc { font-size: 12px; color: var(--muted-foreground); margin-top: 2px; }
.panel-badge { font-size: 13px; font-weight: 600; color: var(--primary); font-variant-numeric: tabular-nums; }
.panel-link {
  background: none; border: none; font-size: 11px;
  color: var(--muted-foreground); cursor: pointer;
  transition: color 0.15s;
}
.panel-link:hover { color: var(--foreground); }
.panel-body { padding: 20px; flex: 1; min-height: 0; overflow: auto; }

/* ========== Resource Cards ========== */
.resource-grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media (min-width: 1024px) { .resource-grid { grid-template-columns: repeat(3, 1fr); } }

.resource-card {
  padding: 16px; border-radius: var(--radius);
  border: 1px solid oklch(from var(--border) l c h / 0.6);
  background: oklch(from var(--card) l c h / 0.4);
}
.resource-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.resource-label { font-size: 13px; font-weight: 600; }
.resource-val { font-size: 13px; font-weight: 600; color: var(--primary); font-variant-numeric: tabular-nums; }

.progress {
  height: 8px; border-radius: 9999px;
  background: var(--muted); overflow: hidden;
}
.progress-fill {
  height: 100%; border-radius: 9999px;
  background: var(--primary);
  transition: width 0.5s ease-out;
}
.resource-foot {
  display: flex; justify-content: space-between; margin-top: 8px;
  font-size: 11px; color: var(--muted-foreground);
}

/* ========== Logs ========== */
.log-list { display: flex; flex-direction: column; gap: 4px; }
.log-item-simple {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 4px 8px; border-radius: 6px;
  font-size: 11px; line-height: 1.5;
  font-family: 'JetBrains Mono', monospace;
  transition: background 0.1s;
}
.log-item-simple:hover { background: oklch(from var(--accent) l c h / 0.3); }

.log-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 12px; gap: 16px; }
.log-header-left { min-width: 0; }
.log-title-row { display: flex; align-items: center; gap: 8px; }
.log-title { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.live-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 9999px;
  background: oklch(from var(--success) l c h / 0.12);
  color: var(--success); font-size: 11px; font-weight: 600;
}
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: dotBlink 2s ease-in-out infinite; }
.log-meta { font-size: 12px; color: var(--muted-foreground); margin-top: 4px; }

.log-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.log-search {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--muted);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.log-search:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15); }
.search-icon { color: var(--muted-foreground); flex-shrink: 0; }
.search-input { border: none; background: transparent; outline: none; font-size: 12px; color: var(--foreground); width: 180px; }
.search-input::placeholder { color: var(--muted-foreground); }

.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted-foreground); cursor: pointer;
  transition: all 0.15s;
}
.icon-btn:hover { background: var(--accent); color: var(--foreground); border-color: oklch(from var(--foreground) l c h / 0.2); }

.log-filters {
  display: flex; gap: 4px; padding: 0 24px 12px;
  border-bottom: 1px solid var(--border);
}
.filter-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 6px;
  border: none; background: transparent;
  color: var(--muted-foreground); font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.filter-tab:hover { background: var(--accent); color: var(--foreground); }
.filter-tab.active { background: var(--accent); color: var(--foreground); }
.filter-dot { width: 6px; height: 6px; border-radius: 50%; }

.log-table-header {
  display: grid; grid-template-columns: 90px 100px 80px 1fr;
  gap: 8px; padding: 10px 24px;
  font-size: 11px; font-weight: 500; color: var(--muted-foreground);
  border-bottom: 1px solid var(--border);
}

.log-scroll { flex: 1; overflow-y: auto; min-height: 0; }

.log-row {
  display: grid; grid-template-columns: 90px 100px 80px 1fr;
  gap: 8px; padding: 6px 24px;
  font-size: 12px; line-height: 1.5;
  font-family: 'JetBrains Mono', monospace;
  transition: background 0.1s;
  border-bottom: 1px solid oklch(from var(--border) l c h / 0.3);
}
.log-row:hover { background: oklch(from var(--accent) l c h / 0.25); }
.log-row .col-time { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.log-row .col-module { color: var(--muted-foreground); }

.level-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border-radius: 4px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.03em;
}
.level-dot { width: 5px; height: 5px; border-radius: 50%; }
.level-info { background: oklch(from #38bdf8 l c h / 0.12); color: #38bdf8; }
.level-info .level-dot { background: #38bdf8; }
.level-success { background: oklch(from #22c55e l c h / 0.12); color: #22c55e; }
.level-success .level-dot { background: #22c55e; }
.level-warn { background: oklch(from #f59e0b l c h / 0.12); color: #f59e0b; }
.level-warn .level-dot { background: #f59e0b; }
.level-error { background: oklch(from #ef4444 l c h / 0.12); color: #ef4444; }
.level-error .level-dot { background: #ef4444; }

.log-row .col-msg { color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty-state { color: var(--muted-foreground); text-align: center; padding: 48px; font-size: 13px; animation: float 3s ease-in-out infinite; }

/* ========== Charts ========== */
.chart-container { display: grid; grid-template-columns: 48px 1fr; grid-template-rows: 1fr auto; gap: 0; height: 200px; overflow: hidden; }
.chart-y-axis { grid-row: 1; grid-column: 1; display: flex; flex-direction: column; justify-content: space-between; padding-right: 8px; font-size: 10px; color: var(--muted-foreground); text-align: right; font-variant-numeric: tabular-nums; }
.chart-main { grid-row: 1; grid-column: 2; position: relative; overflow: visible; }
.chart-svg { width: 100%; height: 100%; overflow: visible; display: block; }
.chart-x-axis { grid-row: 2; grid-column: 2; display: flex; justify-content: space-between; padding-top: 6px; font-size: 10px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.chart-tooltip {
  position: fixed; pointer-events: none;
  transform: translate(-50%, -100%);
  background: var(--foreground); color: var(--background);
  border-radius: 8px; padding: 8px 12px;
  font-size: 12px; white-space: nowrap; z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.tooltip-title { font-weight: 700; font-size: 13px; margin-bottom: 2px; }
.tooltip-value { font-size: 11px; opacity: 0.8; }
.empty-chart { height: 200px; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); font-size: 12px; }

/* ========== Message ========== */
.msg-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.msg-toast { margin-top: 12px; font-size: 12px; padding: 8px 12px; border-radius: 8px; }
.msg-toast.success { background: oklch(from var(--success) l c h / 0.1); color: var(--success); }
.msg-toast.error { background: oklch(from var(--destructive) l c h / 0.1); color: var(--destructive); }

/* ========== CLI ========== */
.cli-box {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--muted);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cli-box:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15); }
.cli-prompt { color: var(--primary); font-family: 'JetBrains Mono', monospace; font-size: 14px; }
.cli-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-family: 'JetBrains Mono', monospace; font-size: 13px;
  color: var(--foreground);
}
.cli-input::placeholder { color: var(--muted-foreground); }
.cli-result {
  margin-top: 12px; padding: 12px 14px;
  background: var(--muted); border: 1px solid var(--border);
  border-radius: 8px; font-family: 'JetBrains Mono', monospace;
  font-size: 11px; color: var(--muted-foreground);
  white-space: pre-wrap; line-height: 1.6;
}

/* ========== Buttons ========== */
.btn-primary {
  padding: 8px 16px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 500;
  background: var(--primary); color: var(--primary-foreground);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.btn-primary:hover { opacity: 0.9; }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.btn-outline {
  padding: 8px 16px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted-foreground); font-size: 13px;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.btn-outline:hover { background: var(--accent); color: var(--foreground); border-color: oklch(from var(--foreground) l c h / 0.2); }
.btn-outline:active { transform: scale(0.98); }

/* ========== Inputs ========== */
.select-input, .select-sm {
  padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--muted); color: var(--foreground);
  font-size: 13px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.select-input:focus, .select-sm:focus { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15); }
.select-input { min-width: 220px; }
.text-input {
  padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--muted); color: var(--foreground);
  font-size: 13px; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.text-input:focus { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15); }
.text-input::placeholder { color: var(--muted-foreground); }
.flex1 { flex: 1; min-width: 0; }
.check-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted-foreground); cursor: pointer; }
.check-label input { accent-color: var(--primary); }

/* ========== Animations ========== */
.anim-fade-up {
  animation: fadeUp 0.4s ease-out both;
}
.anim-fade-in {
  animation: fadeIn 0.3s ease-out both;
}
.anim-scale-in {
  animation: scaleIn 0.3s ease-out both;
}
.anim-slide-left {
  animation: slideInLeft 0.35s ease-out both;
}
.anim-slide-right {
  animation: slideInRight 0.35s ease-out both;
}

/* Staggered children */
.stat-grid .stat-card:nth-child(1) { animation-delay: 0ms; }
.stat-grid .stat-card:nth-child(2) { animation-delay: 50ms; }
.stat-grid .stat-card:nth-child(3) { animation-delay: 100ms; }
.stat-grid .stat-card:nth-child(4) { animation-delay: 150ms; }
.stat-grid .stat-card:nth-child(5) { animation-delay: 200ms; }

/* Panel hover lift */
.panel { transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
.panel:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }

/* Card press effect */
.stat-card { transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease; }
.stat-card:active { transform: scale(0.98); transition-duration: 0.05s; }

/* Button ripple */
.btn-primary { position: relative; overflow: hidden; }
.btn-primary::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
  transform: scale(0); opacity: 0;
  transition: transform 0.4s, opacity 0.4s;
  pointer-events: none;
}
.btn-primary:active::after { transform: scale(2.5); opacity: 0; transition: 0s; }

/* Nav item slide */
.nav-item { transition: all 0.15s ease, transform 0.1s ease; }
.nav-item:active { transform: scale(0.97); }

/* Progress bar grow animation */
.progress-fill { animation: barGrow 0.8s ease-out both; }

/* Log item hover slide */
.log-item { transition: background 0.1s, transform 0.1s ease; }
.log-item:hover { background: oklch(from var(--accent) l c h / 0.3); transform: translateX(2px); }

/* Chart dot float on hover */
.chart-dot { transition: r 0.15s ease, filter 0.15s ease; }
.chart-dot:hover { r: 5; filter: drop-shadow(0 0 4px var(--primary)); }

/* ========== Usage Charts (DeepSeek style) ========== */
.usage-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.usage-header-left { min-width: 0; }
.usage-title { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.usage-subtitle { font-size: 12px; color: var(--muted-foreground); margin-top: 2px; }

.usage-summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.usage-summary-card {
  padding: 16px; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--card);
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}
.usage-summary-label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); }
.usage-summary-val { margin-top: 6px; font-size: 22px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--primary); }

.usage-dual-row { display: grid; gap: 16px; margin-top: 16px; grid-template-columns: 1fr; }
@media (min-width: 768px) { .usage-dual-row { grid-template-columns: 1fr 1fr; } }

.usage-chart-wrap { display: grid; grid-template-columns: 52px 1fr; grid-template-rows: 1fr auto; gap: 0; height: 200px; overflow: hidden; }
.usage-y-axis { grid-row: 1; grid-column: 1; display: flex; flex-direction: column; justify-content: space-between; padding-right: 8px; font-size: 10px; color: var(--muted-foreground); text-align: right; font-variant-numeric: tabular-nums; }
.usage-chart-main { grid-row: 1; grid-column: 2; position: static; overflow: visible; }
.usage-chart-svg { width: 100%; height: 100%; overflow: visible; display: block; }
.usage-x-axis { grid-row: 2; grid-column: 2; display: flex; justify-content: space-between; padding-top: 6px; font-size: 10px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.usage-tooltip {
  position: fixed; pointer-events: none;
  transform: translate(-50%, -100%);
  background: var(--foreground); color: var(--background);
  border-radius: 8px; padding: 8px 12px;
  font-size: 11px; white-space: nowrap; z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}

/* ========== Settings ========== */
.settings-page { max-width: 80rem; }
.settings-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.settings-grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media (min-width: 768px) { .settings-grid { grid-template-columns: 1fr 1fr; } }
.settings-card { min-height: 0; }
.settings-body { padding: 12px 20px !important; max-height: 320px; overflow-y: auto; }
.settings-list { display: flex; flex-direction: column; gap: 8px; }
.settings-item {
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid oklch(from var(--border) l c h / 0.5);
  background: oklch(from var(--card) l c h / 0.3);
}
.settings-item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.settings-user-id { font-size: 13px; font-weight: 600; }
.settings-badge { font-size: 11px; color: var(--muted-foreground); background: var(--muted); padding: 2px 8px; border-radius: 9999px; }
.settings-subs { display: flex; flex-direction: column; gap: 4px; }
.settings-sub { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 6px; font-size: 12px; background: oklch(from var(--muted) l c h / 0.3); }
.settings-acc-id { margin-left: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted-foreground); }
.settings-info-grid { display: flex; flex-direction: column; gap: 8px; }
.settings-info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 6px; background: oklch(from var(--muted) l c h / 0.3); font-size: 13px; }
.settings-info-label { color: var(--muted-foreground); font-size: 12px; }
.settings-toast {
  padding: 10px 16px; border-radius: 8px; margin-bottom: 12px;
  background: oklch(from var(--success) l c h / 0.15); color: var(--success);
  font-size: 13px; text-align: center;
}
.btn-xs {
  padding: 3px 10px; border-radius: 5px; border: none;
  font-size: 11px; cursor: pointer;
  background: oklch(from var(--destructive) l c h / 0.15); color: var(--destructive);
  transition: all 0.15s;
}
.btn-xs:hover { background: oklch(from var(--destructive) l c h / 0.25); }
.text-success { color: var(--success); }
.text-destructive { color: var(--destructive); }

/* ========== System Settings ========== */
.settings-card-wide { grid-column: 1 / -1; }
.sys-hint { font-size: 11px; color: var(--muted-foreground); margin-bottom: 8px; }
.sys-section { display: flex; flex-direction: column; gap: 6px; }
.sys-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.sys-btn {
  padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: transparent; color: var(--foreground); font-size: 12px; cursor: pointer;
  transition: all 0.15s;
}
.sys-btn:hover { background: var(--accent); }
.sys-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sys-btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
.sys-btn-primary:hover { opacity: 0.9; }
.sys-btn-danger { background: oklch(from var(--destructive) l c h / 0.15); color: var(--destructive); border-color: oklch(from var(--destructive) l c h / 0.3); }
.sys-btn-danger:hover { background: oklch(from var(--destructive) l c h / 0.25); }
.sys-textarea {
  width: 100%; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--muted);
  color: var(--foreground); font-size: 12px; font-family: 'JetBrains Mono', monospace;
  resize: vertical; outline: none; box-sizing: border-box;
}
.sys-textarea:focus { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(from var(--ring) l c h / 0.15); }
.sys-toggle-list { display: flex; flex-direction: column; gap: 4px; }
.sys-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  font-size: 12px; transition: background 0.1s;
}
.sys-toggle-row:hover { background: var(--accent); }
.sys-toggle-label { display: flex; align-items: center; gap: 6px; }
.sys-toggle-id { font-size: 10px; color: var(--muted-foreground); font-family: 'JetBrains Mono', monospace; }
.sys-checkbox { accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer; }
.sys-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
.sys-switch input { opacity: 0; width: 0; height: 0; }
.sys-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--border); border-radius: 22px;
  transition: 0.2s;
}
.sys-slider::before {
  content: ''; position: absolute; height: 16px; width: 16px;
  left: 3px; bottom: 3px; background: white; border-radius: 50%;
  transition: 0.2s;
}
.sys-switch input:checked + .sys-slider { background: var(--primary); }
.sys-switch input:checked + .sys-slider::before { transform: translateX(16px); }
.sys-details { margin-top: 8px; }
.sys-summary { font-size: 12px; color: var(--muted-foreground); cursor: pointer; padding: 4px 0; }
.sys-summary:hover { color: var(--foreground); }
.sys-confirm-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.5);
}
.sys-confirm-box {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px; max-width: 360px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.sys-confirm-text { font-size: 14px; margin-bottom: 16px; text-align: center; }

/* Sidebar toggle */
.sidebar { transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1); }

/* Header blur shimmer */
.header { transition: background 0.2s ease; }

/* Status badge pulse */
.status-badge.online .status-dot {
  animation: dotBlink 2s ease-in-out infinite;
}

/* Empty state float */
.empty-state { animation: float 3s ease-in-out infinite; }

/* Page transition wrapper */
.content-wrapper > * {
  animation: fadeUp 0.35s ease-out both;
}

/* ========== Feature Toggle ========== */
.feature-category { margin-bottom: 16px; }
.feature-category:last-child { margin-bottom: 0; }
.feature-category-title {
  font-size: 11px; font-weight: 600; color: var(--muted-foreground);
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
}
.feature-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px; }
.feature-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--card);
  transition: background 0.15s;
}
.feature-item:hover { background: var(--accent); }
.feature-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.feature-name { font-size: 13px; font-weight: 500; color: var(--foreground); }
.feature-desc { font-size: 11px; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toggle-btn {
  position: relative; flex-shrink: 0; width: 40px; height: 22px;
  border: none; border-radius: 22px; cursor: pointer;
  background: var(--border); transition: background 0.2s; padding: 0;
}
.toggle-btn.on { background: var(--primary); }
.toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.toggle-knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.toggle-btn.on .toggle-knob { transform: translateX(18px); }
</style>

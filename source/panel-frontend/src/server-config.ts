/**
 * 服务器连接配置管理
 * 支持本地模式和远程服务器模式
 */

export interface ServerConfig {
  /** 服务器地址，如 http://47.100.100.100:3000 */
  baseUrl: string
  /** WebSocket地址 */
  wsUrl: string
  /** 连接模式 */
  mode: 'local' | 'remote'
  /** 服务器名称（用于显示） */
  name: string
  /** 是否使用HTTPS */
  useHttps: boolean
}

const STORAGE_KEY = 'xingye-server-config'

/** 默认配置（本地模式） */
const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: '',
  wsUrl: '',
  mode: 'local',
  name: '本地服务器',
  useHttps: false
}

/** 获取存储的服务器配置 */
export function getServerConfig(): ServerConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
    }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

/** 保存服务器配置 */
export function saveServerConfig(config: ServerConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

/** 后端固定端口（bot-backend index.ts 中 PORT = 3000） */
const LOCAL_API_BASE = 'http://127.0.0.1:3000'

/**
 * 本地模式下探测 API 基址：
 * - Tauri 桌面壳必须显式指向 127.0.0.1:3000：Tauri v2 在 Windows 上的页面
 *   origin 是 http://tauri.localhost（http 协议！），macOS/Linux 是 tauri://；
 *   若走相对路径 /api/*，请求会被 Tauri 自身的 asset 协议接住并用 index.html
 *   回退（HTTP 200 + text/html + <!doctype html>），导致 JSON 解析失败；
 * - Vite 开发服务器（:5174）同理需要显式基址；
 * - 面板由后端直接托管（http://<服务器IP>:3000）时保持同源相对路径，
 *   以支持局域网/远程访问。
 */
function detectLocalBaseUrl(): string {
  // Tauri 环境检测（__TAURI_INTERNALS__ 注入）是最可靠的信号
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return LOCAL_API_BASE
  if (typeof location === 'undefined') return LOCAL_API_BASE
  const { protocol, hostname } = location
  const isTauriOrigin = (protocol !== 'http:' && protocol !== 'https:')
    || hostname === 'tauri.localhost'
    || hostname.endsWith('.localhost') // ipc.localhost 等变体
  const isLocalHttpHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if (isTauriOrigin || isLocalHttpHost) return LOCAL_API_BASE
  return ''
}

/** 获取API基础URL */
export function getApiBaseUrl(): string {
  const config = getServerConfig()
  if (config.mode === 'remote' && config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '')
  }
  return detectLocalBaseUrl()
}

/** 获取WebSocket URL */
export function getWebSocketUrl(): string {
  const config = getServerConfig()
  if (config.mode === 'remote' && config.wsUrl) {
    return config.wsUrl
  }
  const base = getApiBaseUrl()
  if (base) return base.replace(/^http/, 'ws') // http://127.0.0.1:3000 -> ws://...
  // 同源模式（后端直接托管面板）
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${location.host}`
}

// ================= SnowLuma 会话 token（多用户独立登录） =================
// 后端不再保存任何 SnowLuma 凭据；token 由各浏览器自行持有、随请求附带。
// 不同用户/设备各自登录，互不影响。
const SNOWLUMA_TOKEN_KEY = 'xingye-snowluma-token'

/** 获取当前浏览器保存的 SnowLuma token */
export function getSnowlumaToken(): string {
  try { return localStorage.getItem(SNOWLUMA_TOKEN_KEY) || '' } catch { return '' }
}

/** 保存 SnowLuma token（登录成功后调用） */
export function setSnowlumaToken(token: string): void {
  try { localStorage.setItem(SNOWLUMA_TOKEN_KEY, token) } catch {}
}

/** 清除 SnowLuma token（登出/失效时调用） */
export function clearSnowlumaToken(): void {
  try { localStorage.removeItem(SNOWLUMA_TOKEN_KEY) } catch {}
}

/** 封装fetch，自动添加服务器地址；非 JSON 响应时抛出可读错误而非 "Unexpected token '<'" */
export async function serverFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path}`
  // SnowLuma 相关接口自动附带本浏览器登录得到的 token（后端无状态透传给 :5099）。
  // 登录、状态探测、登出都统一携带；后端登录接口会忽略多余 header，
  // 而 /auth/state 与 /auth/clear 必须带上 token 才能完成"校验/注销"。
  const isSnowluma = path.startsWith('/api/snowluma/')
  const headers: Record<string, string> = {
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (isSnowluma) {
    const token = getSnowlumaToken()
    if (token) headers['X-Snowluma-Token'] = token
  }
  const response = await fetch(url, { ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json') && !path.startsWith('/api/snowluma/avatar')) {
    // 后端未启动/路径错误/代理重定向时会返回 HTML 页面，提前拦截给出可读信息
    const bodyStart = (await response.clone().text()).slice(0, 80).replace(/\s+/g, ' ')
    throw new Error(
      `接口 ${path} 返回非 JSON 响应（HTTP ${response.status}，${contentType || '无 Content-Type'}）。` +
      `可能原因：后端服务(:3000)未启动、接口路径错误或被重定向。响应开头: ${bodyStart}`
    )
  }
  return response
}

/** 创建WebSocket连接 */
export function createServerWebSocket(): WebSocket {
  const wsUrl = getWebSocketUrl()
  return new WebSocket(wsUrl)
}

/** 测试服务器连接 */
export async function testServerConnection(baseUrl: string): Promise<{ success: boolean; message: string; version?: string }> {
  try {
    const url = baseUrl.replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${url}/api/version`, {
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      return {
        success: true,
        message: `连接成功！版本: ${data.version || '未知'}`,
        version: data.version
      }
    } else {
      return { success: false, message: `服务器返回错误: ${response.status}` }
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return { success: false, message: '连接超时（5秒）' }
    }
    return { success: false, message: `连接失败: ${e.message}` }
  }
}

/** 检查是否为远程模式 */
export function isRemoteMode(): boolean {
  return getServerConfig().mode === 'remote'
}

/** 获取连接状态描述 */
export function getConnectionStatusText(): string {
  const config = getServerConfig()
  if (config.mode === 'remote') {
    return `远程: ${config.name || config.baseUrl}`
  }
  return '本地模式'
}

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
  /** 服务器名称（用于显示）**
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

/** 获取API基础URL */
export function getApiBaseUrl(): string {
  const config = getServerConfig()
  if (config.mode === 'remote' && config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '')
  }
  return ''
}

/** 获取WebSocket URL */
export function getWebSocketUrl(): string {
  const config = getServerConfig()
  if (config.mode === 'remote' && config.wsUrl) {
    return config.wsUrl
  }
  // 本地模式，使用当前页面地址
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${location.host}`
}

/** 封装fetch，自动添加服务器地址 */
export async function serverFetch(path: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path}`
  return fetch(url, options)
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

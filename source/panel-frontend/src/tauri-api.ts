/**
 * Tauri API 封装 - 提供与 Electron API 兼容的接口
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface VersionInfo {
  version: string
  build: number
  release: string
  description: string
}

export interface UpdateInfo {
  has_update: boolean
  latest_version: string
  current_version: string
}

export interface UpdateProgress {
  stage: string
  percent?: number
}

export interface AppState {
  backend_pid: number | null
  snowluma_pid: number | null
  backend_running: boolean
  snowluma_running: boolean
}

/**
 * Tauri API 封装类
 */
export const tauriApi = {
  /**
   * 获取版本信息
   */
  async getVersion(): Promise<VersionInfo> {
    return await invoke<VersionInfo>('get_version')
  },

  /**
   * 检查更新
   */
  async checkForUpdate(): Promise<UpdateInfo> {
    return await invoke<UpdateInfo>('check_update')
  },

  /**
   * 应用更新
   */
  async applyUpdate(): Promise<void> {
    return await invoke<void>('apply_update')
  },

  /**
   * 重启应用
   */
  async restartApp(): Promise<void> {
    return await invoke<void>('restart_app')
  },

  /**
   * 退出应用
   */
  async quitApp(): Promise<void> {
    return await invoke<void>('quit_app')
  },

  /**
   * 发送CLI命令
   */
  async sendCliCommand(command: string): Promise<string> {
    return await invoke<string>('send_cli_command', { command })
  },

  /**
   * 获取应用状态
   */
  async getAppState(): Promise<AppState> {
    return await invoke<AppState>('get_app_state')
  },

  /**
   * 监听更新进度
   */
  onUpdateProgress(callback: (data: UpdateProgress) => void): () => void {
    const unlisten = listen<UpdateProgress>('update-progress', (event) => {
      callback(event.payload)
    })
    return () => {
      unlisten.then(fn => fn())
    }
  },

  /**
   * 监听日志
   */
  onLog(callback: (data: any) => void): () => void {
    const unlisten = listen<any>('log', (event) => {
      callback(event.payload)
    })
    return () => {
      unlisten.then(fn => fn())
    }
  },

  /**
   * 窗口控制
   */
  window: {
    async minimize() {
      await getCurrentWindow().minimize()
    },
    async maximize() {
      const window = getCurrentWindow()
      const isMaximized = await window.isMaximized()
      if (isMaximized) {
        await window.unmaximize()
      } else {
        await window.maximize()
      }
    },
    async close() {
      await getCurrentWindow().hide()
    },
    async toggleFullscreen() {
      const window = getCurrentWindow()
      const isFullscreen = await window.isFullscreen()
      await window.setFullscreen(!isFullscreen)
    }
  }
}

/**
 * 检测是否在Tauri环境中
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

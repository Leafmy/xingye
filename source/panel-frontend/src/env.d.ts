interface ElectronUpdateProgress {
  stage: string
  percent?: number
}

interface ElectronApi {
  getVersion: () => Promise<Record<string, unknown>>
  checkForUpdate: () => Promise<any>
  applyUpdate: (updateInfo: any) => Promise<any>
  restartApp: () => Promise<void>
  quitApp: () => Promise<void>
  getModuleState: () => Promise<{ main_pid: number | null; module_enabled: boolean; backend_running: boolean; snowluma_running: boolean }>
  setModuleEnabled: (enabled: boolean) => Promise<{ main_pid: number | null; module_enabled: boolean; backend_running: boolean; snowluma_running: boolean }>
  openExternal: (url: string) => Promise<void>
  onUpdateProgress: (callback: (data: ElectronUpdateProgress) => void) => void
  onLog: (callback: (data: unknown) => void) => void
}

interface Window {
  electronAPI?: ElectronApi
  __TAURI_INTERNALS__?: Record<string, unknown>
}

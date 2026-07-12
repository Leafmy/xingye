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
  onUpdateProgress: (callback: (data: ElectronUpdateProgress) => void) => void
  onLog: (callback: (data: unknown) => void) => void
}

interface Window {
  electronAPI?: ElectronApi
}

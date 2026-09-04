/**
 * 星野 Xingye - Electron Preload 脚本
 * 通过 contextBridge 安全地暴露 IPC 接口给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 版本信息
  getVersion: () => ipcRenderer.invoke('get-version'),

  // 更新系统
  checkForUpdate: () => ipcRenderer.invoke('check-update'),
  applyUpdate: (patchInfo) => ipcRenderer.invoke('apply-update', patchInfo),

  // 应用控制
  restartApp: () => ipcRenderer.invoke('restart-app'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // 事件监听
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  onLog: (callback) => {
    ipcRenderer.on('log', (event, data) => callback(data));
  }
});

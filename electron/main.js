/**
 * 星野 Xingye - Electron 主进程
 * 职责：子进程管理、窗口创建、IPC 通信、增量更新
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const IncrementalUpdater = require('./updater/updater');

// ================= 路径常量 =================
const ROOT_DIR = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT_DIR, 'app');
const DATA_DIR = path.join(APP_DIR, 'bot-backend', 'data');

// 内置 Node.js 路径（优先）；降级使用系统 node
const BUILTIN_NODE = path.join(ROOT_DIR, 'node', 'node.exe');
let nodeExec = 'node';
if (fs.existsSync(BUILTIN_NODE)) {
  nodeExec = BUILTIN_NODE;
}

// ================= 全局状态 =================
let mainWindow = null;
let backendProcess = null;
let snowlumaProcess = null;
let isUpdating = false;

// ================= 版本信息 =================
function getVersionInfo() {
  const versionPath = path.join(APP_DIR, 'version.json');
  if (fs.existsSync(versionPath)) {
    return JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  }
  return { version: '0.0.0', build: 0 };
}

function getGithubRepo() {
  if (process.env.XINGYE_GITHUB_REPO) return process.env.XINGYE_GITHUB_REPO;
  try {
    return getVersionInfo().githubRepo || '';
  } catch {
    return '';
  }
}

function createUpdater() {
  return new IncrementalUpdater({ appDir: APP_DIR, githubRepo: getGithubRepo() });
}

// ================= 端口检测 =================
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(port, '127.0.0.1');
    server.on('listening', () => { server.close(); resolve(false); });
    server.on('error', () => resolve(true));
  });
}

async function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await isPortInUse(port))) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ================= 子进程管理 =================
function startBackend() {
  const scriptPath = path.join(APP_DIR, 'bot-backend', 'dist', 'index.js');
  const cwd = path.join(APP_DIR, 'bot-backend');

  // 如果编译后的 dist/index.js 不存在，降级用 ts-node
  let args, script;
  if (fs.existsSync(scriptPath)) {
    script = nodeExec;
    args = [scriptPath];
  } else {
    // 开发模式降级
    script = 'npx';
    args = ['ts-node', 'index.ts'];
  }

  console.log(`[Xingye] Starting backend: ${script} ${args.join(' ')}`);
  backendProcess = spawn(script, args, {
    cwd,
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STEAM_PROXY_URL: process.env.STEAM_PROXY_URL || 'http://127.0.0.1:7890'
    }
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
    mainWindow?.webContents.send('log', { level: 'info', message: data.toString().trim() });
  });
  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend] ${data.toString().trim()}`);
    mainWindow?.webContents.send('log', { level: 'error', message: data.toString().trim() });
  });
  backendProcess.on('close', (code) => {
    console.log(`[Backend] Exited with code ${code}`);
    backendProcess = null;
  });
}

function startSnowluma() {
  const scriptPath = path.join(APP_DIR, 'SnowLuma', 'index.mjs');
  const cwd = path.join(APP_DIR, 'SnowLuma');

  console.log(`[Xingye] Starting SnowLuma: ${nodeExec} ${scriptPath}`);
  snowlumaProcess = spawn(nodeExec, [scriptPath], {
    cwd,
    stdio: 'pipe',
    shell: true
  });

  snowlumaProcess.stdout?.on('data', (data) => {
    console.log(`[SnowLuma] ${data.toString().trim()}`);
  });
  snowlumaProcess.stderr?.on('data', (data) => {
    console.error(`[SnowLuma] ${data.toString().trim()}`);
  });
  snowlumaProcess.on('close', (code) => {
    console.log(`[SnowLuma] Exited with code ${code}`);
    snowlumaProcess = null;
  });
}

function killChildProcesses() {
  if (backendProcess) {
    try { backendProcess.kill('SIGTERM'); } catch {}
    backendProcess = null;
  }
  if (snowlumaProcess) {
    try { snowlumaProcess.kill('SIGTERM'); } catch {}
    snowlumaProcess = null;
  }
}

// ================= 窗口创建 =================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '星野 Xingye',
    icon: path.join(ROOT_DIR, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    // 隐藏原生菜单栏
    autoHideMenuBar: true,
    show: false
  });

  // 等待后端启动后加载页面
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ================= IPC 通道 =================
function setupIPC() {
  // 获取版本信息
  ipcMain.handle('get-version', () => {
    return getVersionInfo();
  });

  // 检查更新
  ipcMain.handle('check-update', async () => {
    try {
      const result = await createUpdater().checkForUpdates();
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 应用更新
  ipcMain.handle('apply-update', async (event, patchInfo) => {
    if (isUpdating) return { success: false, error: '更新进行中...' };
    isUpdating = true;

    try {
      // 通知前端开始更新
      mainWindow?.webContents.send('update-progress', { stage: 'stopping', percent: 0 });

      // 1. 停止子进程
      killChildProcesses();
      await new Promise(r => setTimeout(r, 2000));

      // 2. 应用更新
      const updater = createUpdater();

      mainWindow?.webContents.send('update-progress', { stage: 'downloading', percent: 20 });

      const candidate = patchInfo || await updater.checkForUpdates();
      const update = await updater.resolveUpdate(candidate);
      if (update.type === 'full') {
        await updater.applyFullUpdate(update.fullUrl, update.checksumsUrl);
      } else {
        await updater.applyPatch(update.patchInfo);
      }

      mainWindow?.webContents.send('update-progress', { stage: 'done', percent: 100 });

      // 3. 重启应用
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1000);

      return { success: true };
    } catch (err) {
      isUpdating = false;
      return { success: false, error: err.message };
    }
  });

  // 重启应用
  ipcMain.handle('restart-app', async () => {
    killChildProcesses();
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
  });

  // 关闭应用
  ipcMain.handle('quit-app', () => {
    killChildProcesses();
    app.quit();
  });
}

// ================= 应用生命周期 =================
app.whenReady().then(async () => {
  // 1. 增量更新检查（启动时自动）
  try {
    const updater = createUpdater();
    const updateInfo = await updater.checkForUpdates();
    if (updateInfo.hasUpdate) {
      const update = await updater.resolveUpdate(updateInfo);
      // 弹窗询问是否更新
      const result = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${updateInfo.latestVersion}`,
        detail: `当前版本：${getVersionInfo().version}\n最新版本：${updateInfo.latestVersion}\n\n是否立即更新？`,
        buttons: ['立即更新', '稍后再说'],
        defaultId: 0
      });

      if (result.response === 0) {
        isUpdating = true;
        killChildProcesses();
        await new Promise(r => setTimeout(r, 2000));

        if (update.type === 'full') {
          await updater.applyFullUpdate(update.fullUrl, update.checksumsUrl);
        } else {
          await updater.applyPatch(update.patchInfo);
        }

        app.relaunch();
        app.exit(0);
        return;
      }
    }
  } catch (err) {
    console.error('[Updater] Check failed:', err.message);
  }

  // 2. 启动子进程
  startSnowluma();
  startBackend();

  // 3. 等待后端就绪
  const ready = await waitForPort(3000, 30000);
  if (!ready) {
    console.error('[Xingye] Backend failed to start within 30s');
  }

  // 4. 创建窗口
  setupIPC();
  createWindow();
});

// 退出时清理
app.on('before-quit', () => {
  killChildProcesses();
});

app.on('window-all-closed', () => {
  killChildProcesses();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================================
// HtmlToImage — 无头浏览器截图（CDP 直连，替代 Playwright）
//
// 设计要点：
// - 不再随包分发 Playwright（约 16.7MB）与其浏览器内核；改为复用系统上已有的
//   Microsoft Edge / Google Chrome，通过 DevTools Protocol 驱动。
// - 浏览器实例**懒启动**：第一次需要渲染时才拉起，空闲 IDLE_SHUTDOWN_MS 后自动退出，
//   因此不使用攻略功能时进程与内存占用为 0。
// - 只依赖已经存在的 `ws`（后端 WebSocket 客户端）做 CDP 信道，不新增依赖。
// - 渲染失败时抛出异常，调用方沿用原有的 try/catch 降级为纯文本回复。
// ============================================================

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import WebSocket from 'ws';
import { toFileUrl } from '../../app-paths';

/** 空闲多久后关闭浏览器（默认 3 分钟） */
const IDLE_SHUTDOWN_MS = Number(process.env.XINGYE_RENDER_IDLE_MS || 180_000);
/** 单次渲染超时 */
const RENDER_TIMEOUT_MS = Number(process.env.XINGYE_RENDER_TIMEOUT_MS || 30_000);

export interface RenderOptions {
  width: number;
  height: number;
  /** 设备像素比，2 = Retina 级输出 */
  scale?: number;
  /** 最大高度上限，防止超长页面截图爆内存 */
  maxHeight?: number;
  /** 配色方案模拟（面板明暗主题自检用） */
  colorScheme?: 'light' | 'dark';
  /** 渲染后额外等待的毫秒数（等待前端脚本完成取数/绘制） */
  settleMs?: number;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string };
  sessionId?: string;
}

/** 候选浏览器可执行文件（按优先级） */
function browserCandidates(): string[] {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  return [
    process.env.XINGYE_BROWSER_PATH || '',
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean);
}

export function findBrowserExecutable(): string | null {
  for (const candidate of browserCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return null;
}

/** 极简 CDP 客户端：单连接 + flatten session */
class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Map<string, Array<(params: any) => void>>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw: Buffer) => this.onMessage(raw));
    ws.on('close', () => this.failAll(new Error('CDP 连接已关闭')));
    ws.on('error', (err: Error) => this.failAll(err));
  }

  private onMessage(raw: Buffer): void {
    let msg: CdpMessage;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }

    if (typeof msg.id === 'number') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error.message || 'CDP 调用失败'));
      else entry.resolve(msg.result);
      return;
    }

    if (msg.method) {
      const key = this.eventKey(msg.sessionId, msg.method);
      const handlers = this.listeners.get(key);
      if (!handlers) return;
      this.listeners.delete(key);
      for (const h of handlers) h(msg.params);
    }
  }

  private eventKey(sessionId: string | undefined, method: string): string {
    return `${sessionId || ''}::${method}`;
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    const payload: CdpMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, RENDER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload), (err?: Error) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  once(sessionId: string | undefined, method: string, timeoutMs = RENDER_TIMEOUT_MS): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const key = this.eventKey(sessionId, method);
      const timer = setTimeout(() => {
        const arr = this.listeners.get(key) || [];
        this.listeners.set(key, arr.filter(h => h !== handler));
        reject(new Error(`等待 ${method} 超时`));
      }, timeoutMs);

      const handler = (params: any) => { clearTimeout(timer); resolve(params); };
      const arr = this.listeners.get(key) || [];
      arr.push(handler);
      this.listeners.set(key, arr);
    });
  }

  close(): void {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function httpGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e: any) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP 超时')));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 删除临时 profile。
 * Windows 上浏览器刚退出时文件句柄可能还没释放，直接删会失败，
 * 因此做几次重试；仍失败只是留下一个空临时目录，不影响功能。
 */
async function removeProfileDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await delay(200 * (attempt + 1));
    }
  }
}

/** 读取 Chrome 写出的 DevToolsActivePort（避免解析 stderr 的时序问题） */
async function waitForDevtoolsPort(profileDir: string, timeoutMs = 20_000): Promise<number> {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(portFile)) {
        const first = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
        const port = Number(first);
        if (Number.isInteger(port) && port > 0) return port;
      }
    } catch { /* 文件可能正在写入 */ }
    await delay(120);
  }
  throw new Error('无头浏览器启动超时（未生成 DevToolsActivePort）');
}

/**
 * HTML → PNG 渲染器。
 * 全局单例即可满足后端「一个进程一个浏览器」的需求。
 */
export class HtmlToImage {
  private child: ChildProcess | null = null;
  private client: CdpClient | null = null;
  private profileDir: string | null = null;
  private starting: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  /** 渲染本地 HTML 文件为 PNG Buffer */
  async renderFile(htmlPath: string, opts: RenderOptions): Promise<Buffer> {
    return this.renderUrl(toFileUrl(htmlPath), opts);
  }

  /** 渲染任意 URL 为 PNG Buffer（自检 / 主题截图用） */
  async renderUrl(url: string, opts: RenderOptions): Promise<Buffer> {
    await this.ensureBrowser();
    this.touchIdleTimer();

    const client = this.client!;
    const maxHeight = opts.maxHeight || 3000;
    const scale = opts.scale || 2;

    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

    try {
      await client.send('Page.enable', {}, sessionId);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: opts.width,
        height: opts.height,
        deviceScaleFactor: scale,
        mobile: false,
      }, sessionId);
      if (opts.colorScheme) {
        await client.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: opts.colorScheme }],
        }, sessionId);
      }

      const loaded = client.once(sessionId, 'Page.loadEventFired');
      await client.send('Page.navigate', { url }, sessionId);
      await loaded;
      // 等待模板内联脚本/字体/图片落位
      await delay(opts.settleMs ?? Number(process.env.XINGYE_RENDER_SETTLE_MS || 400));

      const metrics = await client.send('Page.getLayoutMetrics', {}, sessionId);
      const contentHeight = Math.ceil(
        metrics?.cssContentSize?.height || metrics?.contentSize?.height || opts.height
      );
      const height = Math.max(1, Math.min(contentHeight, maxHeight));

      // 内容高度与视口不一致时，把视口同步到实际高度，保证整页截图
      if (Math.abs(height - opts.height) > 1) {
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: opts.width,
          height,
          deviceScaleFactor: scale,
          mobile: false,
        }, sessionId);
      }

      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y: 0, width: opts.width, height, scale: 1 },
      }, sessionId);

      if (!shot?.data) throw new Error('截图返回空数据');
      return Buffer.from(shot.data, 'base64');
    } finally {
      try { await client.send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
    }
  }

  /** 浏览器是否已就绪 */
  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null;
  }

  /** 主动关闭浏览器，释放内存 */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const child = this.child;
    const profile = this.profileDir;
    this.child = null;
    this.profileDir = null;
    this.starting = null;
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* ignore */ }
      // Windows 下 Chrome 会派生子进程，等待退出失败时用 taskkill 收尾
      const exited = new Promise<boolean>(resolve => {
        const t = setTimeout(() => resolve(false), 3000);
        child.once('exit', () => { clearTimeout(t); resolve(true); });
      });
      if (!(await exited) && process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { /* ignore */ }
      }
    }
    if (profile) {
      await removeProfileDir(profile);
    }
  }

  private touchIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.shutdown().catch(() => { /* ignore */ });
    }, IDLE_SHUTDOWN_MS);
    // 不因浏览器空闲计时器而阻止进程退出
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref();
  }

  private async ensureBrowser(): Promise<void> {
    if (this.client && this.isRunning()) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async launch(): Promise<void> {
    const exe = findBrowserExecutable();
    if (!exe) {
      throw new Error('未找到可用的无头浏览器（Edge / Chrome），请设置 XINGYE_BROWSER_PATH');
    }

    // 临时 profile 放在系统临时目录，避免污染用户浏览器数据
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xingye-render-'));
    this.profileDir = profileDir;

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--hide-scrollbars',
      '--mute-audio',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
    ];

    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    this.child = child;

    child.once('exit', () => {
      // 浏览器意外退出时清空句柄，下次渲染会重新拉起
      if (this.child === child) {
        this.child = null;
        if (this.client) { this.client.close(); this.client = null; }
      }
    });

    const port = await waitForDevtoolsPort(profileDir);
    const version = await httpGetJson(`http://127.0.0.1:${port}/json/version`);
    const wsUrl: string = version?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('无法获取浏览器调试地址');

    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { ws.off('error', onError); resolve(); };
      const onError = (err: Error) => { ws.off('open', onOpen); reject(err); };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });

    this.client = new CdpClient(ws);
    console.log(`[HtmlToImage] 已启动无头浏览器: ${path.basename(exe)} (port ${port})`);
  }
}

/** 进程级单例 */
export const htmlToImage = new HtmlToImage();

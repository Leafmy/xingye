// ============================================================
// GenshinDataProvider — 原神攻略数据「按需下载 + 本地缓存」
//
// 背景:
//   旧版把 miao-plugin 的 meta-gs 图库（约 139MB / 2380 个文件）直接打进发布包，
//   占整个绿色包体的 ~30%。这些数据是纯静态、可再生、且只在用户真的发
//   「gs 角色名 / xx面板」指令时才需要，因此改为首次使用时按需拉取并缓存。
//
// 设计:
//   - 基础元数据（角色注册表 / 别名 / 词条权重，合计约 70KB）在模块初始化时拉取，
//     成本可忽略；单个角色的数据与图片（约 1.4MB）在第一次查询该角色时拉取。
//   - 缓存目录取 CACHE_DIR（见 app-paths.ts）：安装到 Program Files 时自动退回
//     用户目录，不因只读磁盘而失效。
//   - 下载走 undici；HTTP(S) 代理取 XINGYE_GS_PROXY / STEAM_PROXY_URL /
//     HTTPS_PROXY / ALL_PROXY 中第一个可用的（实测 FlClash 的 http 代理可用）。
//   - 网络不可用时**不抛异常中断**：返回 false，调用方沿用原有的降级路径
//     （纯文本攻略 / 「数据未就绪」提示）。
//   - 兼容旧安装：若发布目录里仍然存在随包分发的 miao-data，则直接复用。
// ============================================================

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { request, ProxyAgent, type Dispatcher } from 'undici';
import { GS_CACHE_DIR, ensureDir } from '../../app-paths';

const execFileAsync = promisify(execFile);

/** 上游仓库（miao-plugin）的原始文件根地址 */
const MIAO_RAW_BASE = process.env.XINGYE_MIAO_RAW_BASE
  || 'https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/master/resources/meta-gs';
const LIANGSHI_REPO = process.env.XINGYE_LIANGSHI_REPO
  || 'https://github.com/liangshi233/liangshi-calc.git';

/** 必需的元数据文件（缺失说明基础数据没准备好） */
const MIAO_BASE_FILES = [
  'character/data.json',
  'character/alias.js',
  'artifact/artis-mark.js',
];

/**
 * 单个角色需要补齐的文件。
 * 分两档：core 用于「攻略 / 面板」文字与卡片渲染；extra 是攻略图里用到的美化素材，
 * 拉取失败不影响主流程（全部按 best-effort 处理）。
 */
const CHARACTER_FILES = [
  'data.json',
  'calc.js',
  'artis.js',
  'calc_auto.js',
  'imgs/face.webp',
  'imgs/gacha.webp',
  'imgs/card.webp',
  'imgs/side.webp',
  'imgs/banner.webp',
  'imgs/splash.webp',
  'imgs/splash2.webp',
  'imgs/face-q.webp',
  'imgs/face2.webp',
  'imgs/side2.webp',
  'icons/cons-1.webp',
  'icons/cons-2.webp',
  'icons/cons-3.webp',
  'icons/cons-4.webp',
  'icons/cons-5.webp',
  'icons/cons-6.webp',
  'icons/passive-0.webp',
  'icons/passive-1.webp',
  'icons/passive-2.webp',
];

/** 下游可能残留的旧布局（随包分发的图库） */
function legacyMiaoRoots(): string[] {
  return [
    path.join(__dirname, '..', 'miao-data', 'meta-gs'),
    path.join(__dirname, '..', '..', 'miao-data', 'meta-gs'),
  ];
}

function legacyLiangshiRoots(): string[] {
  return [
    path.join(__dirname, '..', 'liangshi-data'),
    path.join(__dirname, '..', '..', 'liangshi-data'),
  ];
}

function hasBase(root: string): boolean {
  return MIAO_BASE_FILES.every(f => fs.existsSync(path.join(root, f)));
}

function isCompleteLiangshi(root: string): boolean {
  return fs.existsSync(path.join(root, 'damage'))
    && fs.existsSync(path.join(root, 'resources'));
}

/** 解析代理地址 */
function proxyUrl(): string | null {
  for (const key of ['XINGYE_GS_PROXY', 'STEAM_PROXY_URL', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

let cachedDispatcher: Dispatcher | null | undefined;
function dispatcher(): Dispatcher | undefined {
  if (cachedDispatcher === undefined) {
    const url = proxyUrl();
    try {
      cachedDispatcher = url ? new ProxyAgent(url) : null;
    } catch (err: any) {
      console.warn(`[GSData] 代理不可用(${url}): ${err.message}，改为直连`);
      cachedDispatcher = null;
    }
  }
  return cachedDispatcher || undefined;
}

/** 单次 HTTP GET，返回 Buffer；3xx 手动跟随（undici v8 不再支持 maxRedirections） */
async function httpGet(url: string, depth = 0): Promise<Buffer | null> {
  if (depth > 5) throw new Error('重定向次数过多');
  const res = await request(url, {
    dispatcher: dispatcher(),
    headers: { 'user-agent': 'Xingye/0.6 (+https://github.com/Leafmy/xingye)' },
    headersTimeout: 20_000,
    bodyTimeout: 60_000,
  });

  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    // 丢弃响应体，避免连接泄漏
    await res.body.dump().catch(() => { /* ignore */ });
    const next = new URL(String(res.headers.location), url).toString();
    return httpGet(next, depth + 1);
  }
  if (res.statusCode === 404) {
    await res.body.dump().catch(() => { /* ignore */ });
    return null;
  }
  if (res.statusCode !== 200) {
    await res.body.dump().catch(() => { /* ignore */ });
    throw new Error(`HTTP ${res.statusCode}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** 下载单文件到目标路径；已存在则跳过。返回是否成功。 */
async function downloadFile(url: string, dest: string, optional: boolean): Promise<boolean> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
  try {
    const data = await httpGet(url);
    if (!data) {
      if (!optional) console.warn(`[GSData] 上游不存在: ${url}`);
      return false;
    }
    ensureDir(path.dirname(dest));
    // 先写临时文件再改名，避免半截文件被当成有效缓存
    const tmp = `${dest}.part-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
    return true;
  } catch (err: any) {
    if (!optional) console.warn(`[GSData] 下载失败 ${path.basename(dest)}: ${err.message}`);
    return false;
  }
}

export class GenshinDataProvider {
  /** 正在进行的初始化/角色下载，避免并发重复拉取 */
  private static basePromise: Promise<string> | null = null;
  private static charPromises = new Map<string, Promise<boolean>>();
  private static liangshiPromise: Promise<string> | null = null;
  /** 上游是否已经明确不可用（避免每个角色都重试） */
  private static upstreamDown = false;

  /** miao meta-gs 根目录（同步解析，可能尚未下载） */
  static miaoRoot(): string {
    for (const legacy of legacyMiaoRoots()) {
      if (hasBase(legacy)) return legacy;
    }
    return path.join(GS_CACHE_DIR, 'miao', 'meta-gs');
  }

  /** liangshi-calc 根目录（同步解析，可能尚未下载） */
  static liangshiRoot(): string {
    for (const legacy of legacyLiangshiRoots()) {
      if (isCompleteLiangshi(legacy)) return legacy;
    }
    return path.join(GS_CACHE_DIR, 'liangshi');
  }

  /** 是否已有可用的基础元数据 */
  static hasBase(): boolean {
    return hasBase(this.miaoRoot());
  }

  /**
   * 确保基础元数据可用。
   * @returns 可用的 miao 根目录（下载失败时返回原路径，调用方按「未就绪」处理）
   */
  static ensureMiaoBase(): Promise<string> {
    if (hasBase(this.miaoRoot())) return Promise.resolve(this.miaoRoot());
    if (this.basePromise) return this.basePromise;

    const task = (async () => {
      const root = path.join(GS_CACHE_DIR, 'miao', 'meta-gs');
      console.log('[GSData] 首次使用原神攻略，正在拉取基础元数据（约 70KB）...');
      let ok = 0;
      for (const rel of MIAO_BASE_FILES) {
        const url = `${MIAO_RAW_BASE}/${rel}`;
        if (await downloadFile(url, path.join(root, rel), false)) ok++;
      }
      if (ok === 0) {
        this.upstreamDown = true;
        console.warn('[GSData] 基础元数据拉取失败：请检查网络或代理（XINGYE_GS_PROXY / STEAM_PROXY_URL）');
      } else {
        console.log(`[GSData] 基础元数据就绪 (${ok}/${MIAO_BASE_FILES.length}) → ${root}`);
      }
      return root;
    })();

    this.basePromise = task;
    task.then(() => { this.basePromise = null; }, () => { this.basePromise = null; });
    return task;
  }

  /** 确保单个角色的数据与素材已缓存 */
  static ensureCharacter(name: string): Promise<boolean> {
    if (!name) return Promise.resolve(false);
    const dir = path.join(this.miaoRoot(), 'character', name);
    // 已有 data.json 视为就绪（图片属于 best-effort）
    if (fs.existsSync(path.join(dir, 'data.json'))) return Promise.resolve(true);

    const inflight = this.charPromises.get(name);
    if (inflight) return inflight;
    if (this.upstreamDown) return Promise.resolve(false);

    const task = (async () => {
      let core = false;
      for (const rel of CHARACTER_FILES) {
        const url = `${MIAO_RAW_BASE}/character/${encodeURIComponent(name)}/${rel}`;
        const optional = !rel.endsWith('data.json');
        const got = await downloadFile(url, path.join(dir, rel), optional);
        if (got && rel === 'data.json') core = true;
      }
      if (core) console.log(`[GSData] 角色「${name}」数据已缓存 → ${dir}`);
      else console.warn(`[GSData] 角色「${name}」数据拉取失败`);
      return core;
    })();

    this.charPromises.set(name, task);
    task.then(() => this.charPromises.delete(name), () => this.charPromises.delete(name));
    return task;
  }

  /**
   * 确保 liangshi-calc 渲染资源可用（面板图的模板/CSS/字体）。
   * 该数据集体积较大且原先就需要手动执行 init 脚本，因此沿用 shallow clone，
   * 只是把目标目录从只读的资源目录挪到可写缓存。
   */
  static ensureLiangshi(): Promise<string> {
    const root = this.liangshiRoot();
    if (isCompleteLiangshi(root)) return Promise.resolve(root);
    if (this.liangshiPromise) return this.liangshiPromise;

    this.liangshiPromise = (async () => {
      const temp = path.join(GS_CACHE_DIR, `.liangshi-temp-${process.pid}`);
      try {
        ensureDir(GS_CACHE_DIR);
        if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
        console.log('[GSData] 首次生成面板图，正在拉取 liangshi-calc 渲染资源...');
        await execFileAsync('git', ['clone', '--depth', '1', LIANGSHI_REPO, temp], {
          timeout: 180_000,
          windowsHide: true,
        });
        ensureDir(root);
        for (const sub of ['damage', 'resources', 'components']) {
          const src = path.join(temp, sub);
          if (fs.existsSync(src)) {
            fs.cpSync(src, path.join(root, sub), { recursive: true });
          }
        }
        console.log(`[GSData] liangshi 渲染资源就绪 → ${root}`);
      } catch (err: any) {
        console.warn(`[GSData] liangshi 资源拉取失败: ${err.message}`);
      } finally {
        try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* ignore */ }
        this.liangshiPromise = null;
      }
      return root;
    })();

    return this.liangshiPromise;
  }
}

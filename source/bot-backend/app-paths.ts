// ============================================================
// 统一起见：应用根目录与可写数据目录
//
// 开发布局:  <repo>/app/bot-backend/dist/index.js   → APP_ROOT = <repo>/app
// 打包布局:  <install>/app/bot-backend/dist/index.js → APP_ROOT = <install>/app
//
// 所有需要"写"的数据（绑定、订阅、缓存的数据包）都必须落在 dataDir 下；
// 资源目录（dist/）在 NSIS 安装到 Program Files 后是只读的。
// ============================================================

import fs from 'fs';
import path from 'path';

/**
 * 应用根目录（`app/`）。
 * 允许通过 XINGYE_APP_DIR 覆盖，便于测试与特殊部署。
 */
export const APP_ROOT: string = process.env.XINGYE_APP_DIR || (
  fs.existsSync(path.join(__dirname, '..', 'version.json'))
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname, '..', '..')
);

/** 运行数据目录（`app/data`），与历史版本保持一致，避免升级丢数据。 */
export const DATA_DIR: string = path.join(APP_ROOT, 'data');

/** 判断目录是否可写（不写业务文件，只探测）。 */
function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 可写缓存目录。
 * NSIS 安装到 Program Files 后 `app/data` 只读，此时缓存回落到用户目录，
 * 保证「按需下载的原神数据」这类可再生内容不会因为权限问题失效。
 */
export const CACHE_DIR: string = (() => {
  if (process.env.XINGYE_CACHE_DIR) return process.env.XINGYE_CACHE_DIR;
  const preferred = path.join(DATA_DIR, 'cache');
  if (isWritable(preferred)) return preferred;
  const base = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (base) return path.join(base, 'com.xingye.bot', 'cache');
  return preferred;
})();

/** 原神攻略下载缓存根目录（按需下载，不随包分发）。 */
export const GS_CACHE_DIR: string = path.join(CACHE_DIR, 'gs');

/** 确保目录存在并返回路径。 */
export function ensureDir(dir: string): string {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    // 只读盘/权限不足时退化为临时目录，保证功能不因写盘失败而中断
    console.warn(`[Paths] 无法创建目录 ${dir}: ${err.message}`);
  }
  return dir;
}

/** Windows 路径 → file:/// URL（供无头浏览器加载本地图片） */
export function toFileUrl(p: string): string {
  const normalized = path.resolve(p).replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

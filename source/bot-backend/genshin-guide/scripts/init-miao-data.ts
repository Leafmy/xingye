// ============================================================
// 云崽元数据自动下载 / 更新脚本
//
// 用法:
//   ts-node scripts/init-miao-data.ts          # 幂等: 已存在则跳过
//   ts-node scripts/init-miao-data.ts --force  # 强制重新下载
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_URL = 'https://github.com/yoimiya-kokomi/miao-plugin.git';
const TARGET_DIR = path.join(__dirname, '..', 'miao-data');
const TEMP_DIR = path.join(__dirname, '..', '.miao-temp');

/**
 * 初始化云崽元数据
 * 从 miao-plugin 仓库提取 character/ 和 artifact/artis-mark.js
 */
export async function initMiaoData(force = false): Promise<void> {
  const metaGsDst = path.join(TARGET_DIR, 'meta-gs');

  // 幂等检查: 数据已存在则跳过
  if (!force && fs.existsSync(metaGsDst)) {
    // 验证关键文件存在
    const charDataPath = path.join(metaGsDst, 'character', 'data.json');
    const artisMarkPath = path.join(metaGsDst, 'artifact', 'artis-mark.js');
    if (fs.existsSync(charDataPath) && fs.existsSync(artisMarkPath)) {
      console.log('[MiaoData] 数据已存在且完整，跳过下载。使用 --force 强制更新。');
      return;
    }
    console.log('[MiaoData] 数据不完整，重新下载...');
  }

  console.log('[MiaoData] 开始下载 miao-plugin 数据...');

  // 清理临时目录
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  try {
    // 1. Shallow clone
    console.log('[MiaoData] 正在 clone 仓库 (shallow)...');
    execSync(`git clone --depth 1 ${REPO_URL} "${TEMP_DIR}"`, {
      stdio: 'pipe',
      timeout: 120000,
    });

    const srcBase = path.join(TEMP_DIR, 'resources', 'meta-gs');

    if (!fs.existsSync(srcBase)) {
      throw new Error('源仓库中未找到 resources/meta-gs/ 目录');
    }

    // 2. 确保目标目录存在
    fs.mkdirSync(metaGsDst, { recursive: true });

    // 3. 复制角色数据 (整个 character/ 目录)
    const characterSrc = path.join(srcBase, 'character');
    const characterDst = path.join(metaGsDst, 'character');
    if (fs.existsSync(characterSrc)) {
      console.log('[MiaoData] 复制角色数据...');
      fs.cpSync(characterSrc, characterDst, { recursive: true });
    } else {
      console.warn('[MiaoData] 警告: character/ 目录不存在');
    }

    // 4. 复制圣遗物评分权重
    const artifactSrc = path.join(srcBase, 'artifact', 'artis-mark.js');
    const artifactDstDir = path.join(metaGsDst, 'artifact');
    fs.mkdirSync(artifactDstDir, { recursive: true });
    if (fs.existsSync(artifactSrc)) {
      console.log('[MiaoData] 复制圣遗物评分权重...');
      fs.cpSync(artifactSrc, path.join(artifactDstDir, 'artis-mark.js'));
    } else {
      console.warn('[MiaoData] 警告: artifact/artis-mark.js 不存在');
    }

    // 5. 统计下载结果
    const charDirs = fs.readdirSync(characterDst, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .length;
    console.log(`[MiaoData] ✅ 下载完成! 共 ${charDirs} 个角色数据`);

  } catch (err: any) {
    console.error(`[MiaoData] ❌ 下载失败: ${err.message}`);
    throw err;
  } finally {
    // 6. 清理临时目录
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }
}

// CLI 入口
if (require.main === module) {
  const force = process.argv.includes('--force');
  initMiaoData(force).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

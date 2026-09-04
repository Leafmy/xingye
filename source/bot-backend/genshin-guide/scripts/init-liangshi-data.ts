// ============================================================
// liangshi-calc 元数据自动下载 / 更新脚本
//
// 从 liangshi233/liangshi-calc 仓库提取:
//   - damage/liangshi-gs/  → 每角色伤害计算模块
//   - resources/common/    → HTML 模板 + CSS + 字体 + 背景
//
// 用法:
//   ts-node scripts/init-liangshi-data.ts          # 幂等
//   ts-node scripts/init-liangshi-data.ts --force  # 强制更新
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_URL = 'https://github.com/liangshi233/liangshi-calc.git';
const TARGET_DIR = path.join(__dirname, '..', 'liangshi-data');
const TEMP_DIR = path.join(__dirname, '..', '.liangshi-temp');

export async function initLiangshiData(force = false): Promise<void> {
  const damageDst = path.join(TARGET_DIR, 'damage');
  const resourcesDst = path.join(TARGET_DIR, 'resources');

  // 幂等检查
  if (!force && fs.existsSync(damageDst) && fs.existsSync(resourcesDst)) {
    const damageFiles = fs.existsSync(path.join(damageDst, 'liangshi-gs'))
      ? fs.readdirSync(path.join(damageDst, 'liangshi-gs')).length
      : 0;
    if (damageFiles > 0) {
      console.log('[LiangshiData] 数据已存在 (' + damageFiles + ' 个伤害模块)，跳过下载。使用 --force 强制更新。');
      return;
    }
  }

  console.log('[LiangshiData] 开始下载 liangshi-calc 数据...');

  // 清理临时目录
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  try {
    // 1. Shallow clone
    console.log('[LiangshiData] 正在 clone 仓库 (shallow)...');
    execSync(`git clone --depth 1 ${REPO_URL} "${TEMP_DIR}"`, {
      stdio: 'pipe',
      timeout: 120000,
    });

    // 2. 确保目标目录存在
    fs.mkdirSync(TARGET_DIR, { recursive: true });

    // 3. 复制伤害计算模块
    const damageSrc = path.join(TEMP_DIR, 'damage');
    if (fs.existsSync(damageSrc)) {
      console.log('[LiangshiData] 复制伤害计算模块...');
      fs.cpSync(damageSrc, damageDst, { recursive: true });
      const gsCount = fs.existsSync(path.join(damageDst, 'liangshi-gs'))
        ? fs.readdirSync(path.join(damageDst, 'liangshi-gs')).length
        : 0;
      console.log(`[LiangshiData]   → ${gsCount} 个角色伤害模块`);
    }

    // 4. 复制渲染资源 (模板 + CSS + 字体 + 背景)
    const resourcesSrc = path.join(TEMP_DIR, 'resources');
    if (fs.existsSync(resourcesSrc)) {
      console.log('[LiangshiData] 复制渲染资源...');
      fs.cpSync(resourcesSrc, resourcesDst, { recursive: true });
    }

    // 5. 复制组件库 (render.js 等)
    const componentsSrc = path.join(TEMP_DIR, 'components');
    const componentsDst = path.join(TARGET_DIR, 'components');
    if (fs.existsSync(componentsSrc)) {
      console.log('[LiangshiData] 复制组件库...');
      fs.cpSync(componentsSrc, componentsDst, { recursive: true });
    }

    // 6. 统计结果
    console.log('[LiangshiData] ✅ 下载完成!');

  } catch (err: any) {
    console.error(`[LiangshiData] ❌ 下载失败: ${err.message}`);
    throw err;
  } finally {
    // 7. 清理临时目录
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }
}

// CLI 入口
if (require.main === module) {
  const force = process.argv.includes('--force');
  initLiangshiData(force).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
